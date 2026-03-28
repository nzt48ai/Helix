import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.TRADOVATE_SERVER_PORT || 8787);
const FRONTEND_ORIGIN = process.env.HELIX_FRONTEND_ORIGIN || "http://localhost:5173";
const TRADOVATE_CLIENT_ID = process.env.TRADOVATE_CLIENT_ID || "";
const TRADOVATE_CLIENT_SECRET = process.env.TRADOVATE_CLIENT_SECRET || "";
const TRADOVATE_AUTH_URL = process.env.TRADOVATE_AUTH_URL || "https://trader.tradovate.com/oauth";
const TRADOVATE_TOKEN_URL = process.env.TRADOVATE_TOKEN_URL || "https://live-api-d.tradovate.com/auth/oauthtoken";
const TRADOVATE_API_BASE_URL = process.env.TRADOVATE_API_BASE_URL || "https://live-api-d.tradovate.com/v1";
const TRADOVATE_REDIRECT_URI = process.env.TRADOVATE_REDIRECT_URI || `http://localhost:${PORT}/api/tradovate/oauth/callback`;
const SESSION_TTL_MS = Number(process.env.TRADOVATE_SESSION_TTL_MS || 1000 * 60 * 60);

const pendingOAuthStates = new Map();
const tradovateSessions = new Map();

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return acc;
      const key = part.slice(0, separatorIndex).trim();
      const value = decodeURIComponent(part.slice(separatorIndex + 1));
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function buildSessionCookie(sessionId, maxAgeMs = SESSION_TTL_MS) {
  const maxAgeSec = Math.max(0, Math.floor(maxAgeMs / 1000));
  return `helix_tradovate_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

function clearSessionCookie() {
  return "helix_tradovate_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeTradovateAccount(account) {
  if (!account || typeof account !== "object") return null;
  const candidateId = account.id ?? account.accountId ?? account.accountSpec;
  const candidateName = account.name ?? account.nickname ?? account.accountName ?? account.accountSpec;
  const providerAccountId = candidateId === null || candidateId === undefined ? "" : String(candidateId).trim();
  const providerAccountName = candidateName === null || candidateName === undefined ? "" : String(candidateName).trim();
  if (!providerAccountId) return null;
  return {
    providerAccountId,
    providerAccountName: providerAccountName || providerAccountId,
    raw: {
      accountType: account.accountType ?? null,
      active: typeof account.active === "boolean" ? account.active : null,
    },
  };
}

function normalizeTradovateTrade(trade) {
  if (!trade || typeof trade !== "object") return null;
  const providerTradeId =
    trade.fillPairId ?? trade.id ?? trade.tradeId ?? trade.executionId ?? trade.orderId ?? trade.positionId ?? null;
  const openedAt = trade.openedAt ?? trade.entryTimestamp ?? trade.timestamp ?? trade.tradeDate ?? null;
  const closedAt = trade.closedAt ?? trade.exitTimestamp ?? trade.timestamp ?? trade.tradeDate ?? openedAt ?? null;
  const symbol = trade.symbol ?? trade.contractSymbol ?? trade.instrument ?? trade.contractName ?? null;
  const qty = Number(trade.qty ?? trade.quantity ?? trade.contracts ?? 0);
  const pnl = Number(trade.pnl ?? trade.realizedPnl ?? trade.netPnl ?? 0);
  const commission = Number(trade.commission ?? 0);
  const fees = Number(trade.fees ?? trade.fee ?? 0);

  const normalizeIso = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  const normalized = {
    providerTradeId: providerTradeId === null || providerTradeId === undefined ? null : String(providerTradeId),
    symbol: symbol === null || symbol === undefined ? null : String(symbol),
    side: trade.side ?? trade.action ?? trade.direction ?? null,
    entryPrice: Number(trade.entryPrice ?? trade.avgEntryPrice ?? trade.buyPrice ?? 0),
    exitPrice: Number(trade.exitPrice ?? trade.avgExitPrice ?? trade.sellPrice ?? 0),
    quantity: Number.isFinite(qty) ? qty : 0,
    openedAt: normalizeIso(openedAt),
    closedAt: normalizeIso(closedAt),
    pnl: Number.isFinite(pnl) ? pnl : 0,
    commission: Number.isFinite(commission) ? commission : 0,
    fees: Number.isFinite(fees) ? fees : 0,
    netPnl: Number.isFinite(Number(trade.netPnl)) ? Number(trade.netPnl) : (Number.isFinite(pnl) ? pnl - commission - fees : 0),
  };

  if (!normalized.openedAt && !normalized.closedAt) return null;
  return normalized;
}

async function fetchTradovateTrades(accessToken, providerAccountId, from, to) {
  const accountIdNum = Number(providerAccountId);
  const fromIso = typeof from === "string" && from.trim() ? new Date(from).toISOString() : null;
  const toIso = typeof to === "string" && to.trim() ? new Date(to).toISOString() : null;
  const fromTimestamp = fromIso ? Math.floor(new Date(fromIso).getTime() / 1000) : null;
  const toTimestamp = toIso ? Math.floor(new Date(toIso).getTime() / 1000) : null;

  const attempts = [
    {
      url: `${TRADOVATE_API_BASE_URL}/fillPair/list`,
      options: { method: "GET" },
      withQuery: true,
    },
    {
      url: `${TRADOVATE_API_BASE_URL}/fillPair/list`,
      options: { method: "POST", body: {} },
      withQuery: false,
    },
    {
      url: `${TRADOVATE_API_BASE_URL}/orderStrategyFillPair/list`,
      options: { method: "POST", body: {} },
      withQuery: false,
    },
  ];

  for (const attempt of attempts) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    const url = new URL(attempt.url);
    const body = { ...(attempt.options.body || {}) };

    if (Number.isFinite(accountIdNum)) {
      if (attempt.withQuery) url.searchParams.set("accountId", String(accountIdNum));
      else body.accountId = accountIdNum;
    }
    if (fromTimestamp) {
      if (attempt.withQuery) url.searchParams.set("startTimestamp", String(fromTimestamp));
      else body.startTimestamp = fromTimestamp;
    }
    if (toTimestamp) {
      if (attempt.withQuery) url.searchParams.set("endTimestamp", String(toTimestamp));
      else body.endTimestamp = toTimestamp;
    }

    const response = await fetch(url.toString(), {
      method: attempt.options.method,
      headers,
      body: attempt.options.method === "POST" ? JSON.stringify(body) : undefined,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) continue;
    if (!Array.isArray(payload)) continue;
    return payload.map(normalizeTradovateTrade).filter(Boolean);
  }

  throw new Error("Trade retrieval failed.");
}

async function exchangeCodeForToken(code) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: TRADOVATE_CLIENT_ID,
    client_secret: TRADOVATE_CLIENT_SECRET,
    redirect_uri: TRADOVATE_REDIRECT_URI,
    code,
  });

  const response = await fetch(TRADOVATE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const errorDescription = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Token exchange failed: ${errorDescription}`);
  }

  return {
    accessToken: payload.access_token,
    expiresInSec: Number(payload.expires_in) || 0,
    refreshToken: payload.refresh_token || null,
  };
}

async function fetchTradovateAccounts(accessToken) {
  const response = await fetch(`${TRADOVATE_API_BASE_URL}/account/list`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(`Account retrieval failed with HTTP ${response.status}`);
  }

  return payload.map(normalizeTradovateAccount).filter(Boolean);
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [state, value] of pendingOAuthStates.entries()) {
    if (value.expiresAt <= now) pendingOAuthStates.delete(state);
  }
  for (const [sessionId, value] of tradovateSessions.entries()) {
    if (value.expiresAt <= now) tradovateSessions.delete(sessionId);
  }
}

function buildFrontendCallbackUrl(returnTo, params) {
  const target = new URL(returnTo || FRONTEND_ORIGIN);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    target.searchParams.set(key, String(value));
  });
  return target.toString();
}

function validateServerConfiguration() {
  return TRADOVATE_CLIENT_ID.trim() && TRADOVATE_CLIENT_SECRET.trim();
}

const server = http.createServer(async (req, res) => {
  pruneExpiredSessions();

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/tradovate/health") {
    json(res, 200, {
      ok: true,
      configured: Boolean(validateServerConfiguration()),
    });
    return;
  }

  if (req.method === "POST" && ["/api/tradovate/oauth/start", "/api/tradovate/connect/start"].includes(requestUrl.pathname)) {
    if (!validateServerConfiguration()) {
      json(res, 503, {
        error: "Tradovate backend is not configured. Set TRADOVATE_CLIENT_ID and TRADOVATE_CLIENT_SECRET.",
      });
      return;
    }

    try {
      const body = await readRequestBody(req);
      const state = crypto.randomUUID();
      const returnTo = typeof body.returnTo === "string" && body.returnTo.trim() ? body.returnTo : FRONTEND_ORIGIN;
      pendingOAuthStates.set(state, {
        returnTo,
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const authorizeUrl = new URL(TRADOVATE_AUTH_URL);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", TRADOVATE_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", TRADOVATE_REDIRECT_URI);
      authorizeUrl.searchParams.set("state", state);

      json(res, 200, {
        authorizeUrl: authorizeUrl.toString(),
        state,
      });
    } catch (error) {
      json(res, 400, { error: error.message || "Unable to start OAuth flow." });
    }
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/tradovate/oauth/callback") {
    const state = requestUrl.searchParams.get("state") || "";
    const code = requestUrl.searchParams.get("code") || "";
    const oauthError = requestUrl.searchParams.get("error") || "";
    const pendingState = pendingOAuthStates.get(state);
    pendingOAuthStates.delete(state);

    const returnTo = pendingState?.returnTo || FRONTEND_ORIGIN;

    if (!pendingState) {
      redirect(
        res,
        buildFrontendCallbackUrl(returnTo, {
          tvStatus: "error",
          tvError: "missing_or_expired_state",
        })
      );
      return;
    }

    if (oauthError) {
      redirect(
        res,
        buildFrontendCallbackUrl(returnTo, {
          tvStatus: "error",
          tvError: oauthError,
        })
      );
      return;
    }

    if (!code) {
      redirect(
        res,
        buildFrontendCallbackUrl(returnTo, {
          tvStatus: "error",
          tvError: "missing_code",
        })
      );
      return;
    }

    try {
      const tokenData = await exchangeCodeForToken(code);
      const accounts = await fetchTradovateAccounts(tokenData.accessToken);
      const sessionId = crypto.randomUUID();

      tradovateSessions.set(sessionId, {
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS,
        token: {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
        },
        accounts,
      });

      // TODO: Replace in-memory session storage with encrypted persistent storage per user.
      res.writeHead(302, {
        Location: buildFrontendCallbackUrl(returnTo, { tvStatus: "success" }),
        "Set-Cookie": buildSessionCookie(sessionId),
        "Cache-Control": "no-store",
      });
      res.end();
    } catch (error) {
      redirect(
        res,
        buildFrontendCallbackUrl(returnTo, {
          tvStatus: "error",
          tvError: error.message || "oauth_callback_failed",
        })
      );
    }
    return;
  }

  const sessionMatch = requestUrl.pathname.match(/^\/api\/tradovate\/sessions\/([^/]+)\/accounts$/);
  if (req.method === "GET" && (requestUrl.pathname === "/api/tradovate/accounts" || Boolean(sessionMatch))) {
    const cookies = parseCookies(req.headers.cookie || "");
    const sessionId =
      requestUrl.pathname === "/api/tradovate/accounts"
        ? String(cookies.helix_tradovate_session || "").trim()
        : decodeURIComponent(sessionMatch[1]);
    const session = tradovateSessions.get(sessionId);
    if (!session) {
      json(res, 404, { error: "Tradovate session not found or expired." });
      return;
    }

    json(res, 200, {
      accounts: session.accounts,
      expiresAt: session.expiresAt,
    });
    return;
  }

  const disconnectMatch = requestUrl.pathname.match(/^\/api\/tradovate\/sessions\/([^/]+)$/);
  if (
    (req.method === "POST" && requestUrl.pathname === "/api/tradovate/disconnect") ||
    (req.method === "DELETE" && disconnectMatch)
  ) {
    const cookies = parseCookies(req.headers.cookie || "");
    const sessionId =
      req.method === "POST" ? String(cookies.helix_tradovate_session || "").trim() : decodeURIComponent(disconnectMatch[1]);
    tradovateSessions.delete(sessionId);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
      "Set-Cookie": clearSessionCookie(),
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/tradovate/sync-trades") {
    try {
      const body = await readRequestBody(req);
      const helixAccountId = typeof body.helixAccountId === "string" ? body.helixAccountId.trim() : "";
      const providerAccountId = typeof body.providerAccountId === "string" ? body.providerAccountId.trim() : "";
      if (!helixAccountId || !providerAccountId) {
        json(res, 400, { error: "helixAccountId and providerAccountId are required." });
        return;
      }

      const cookies = parseCookies(req.headers.cookie || "");
      const sessionId = String(cookies.helix_tradovate_session || "").trim();
      const session = tradovateSessions.get(sessionId);
      if (!session?.token?.accessToken) {
        json(res, 401, { error: "Tradovate session not found or expired." });
        return;
      }

      const linkedAccount = (session.accounts || []).find((item) => String(item.providerAccountId || "").trim() === providerAccountId);
      if (!linkedAccount) {
        json(res, 403, { error: "Requested account is not linked to this Tradovate session." });
        return;
      }

      const trades = await fetchTradovateTrades(session.token.accessToken, providerAccountId, body.from, body.to);
      json(res, 200, {
        helixAccountId,
        provider: "tradovate",
        providerAccountId,
        trades,
      });
    } catch (error) {
      json(res, 502, { error: error.message || "Unable to sync trades from Tradovate." });
    }
    return;
  }

  json(res, 404, { error: "Not found." });
});

server.listen(PORT, () => {
  console.log(`Tradovate backend listening on http://localhost:${PORT}`);
});
