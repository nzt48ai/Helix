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

  if (req.method === "POST" && requestUrl.pathname === "/api/tradovate/oauth/start") {
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
      redirect(
        res,
        buildFrontendCallbackUrl(returnTo, {
          tvStatus: "success",
          tvSession: sessionId,
        })
      );
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
  if (req.method === "GET" && sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
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
  if (req.method === "DELETE" && disconnectMatch) {
    const sessionId = decodeURIComponent(disconnectMatch[1]);
    tradovateSessions.delete(sessionId);
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: "Not found." });
});

server.listen(PORT, () => {
  console.log(`Tradovate backend listening on http://localhost:${PORT}`);
});
