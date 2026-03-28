const DEFAULT_BACKEND_ORIGIN = "http://localhost:8787";
const PENDING_FLOW_STORAGE_KEY = "helix.tradovate.pending.prop.flow.v1";

function getBackendBaseUrl() {
  const configured = String(import.meta.env.VITE_TRADOVATE_BACKEND_URL || "").trim();
  return configured || DEFAULT_BACKEND_ORIGIN;
}

function buildEndpoint(pathname) {
  return `${getBackendBaseUrl()}${pathname}`;
}

async function parseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || `Tradovate request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export function createReturnToUrl() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  ["tvStatus", "tvError", "tvSession"].forEach((key) => url.searchParams.delete(key));
  return url.toString();
}

export async function startTradovateOAuth(returnTo) {
  const response = await fetch(buildEndpoint("/api/tradovate/connect/start"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ returnTo }),
  });

  return parseJson(response);
}

export async function fetchTradovateAccounts() {
  const response = await fetch(buildEndpoint("/api/tradovate/accounts"), {
    method: "GET",
    credentials: "include",
  });

  return parseJson(response);
}

export async function disconnectTradovateSession() {
  const response = await fetch(buildEndpoint("/api/tradovate/disconnect"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });

  return parseJson(response);
}

export function readTradovateOAuthResultFromLocation() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const status = params.get("tvStatus");
  const sessionId = params.get("tvSession");
  const error = params.get("tvError");
  if (!status && !sessionId && !error) return null;
  return {
    status,
    sessionId,
    error,
  };
}

export function clearTradovateOAuthParamsFromLocation() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  ["tvStatus", "tvError", "tvSession"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, "", url.toString());
}

export function persistPendingPropTradovateFlow(value) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_FLOW_STORAGE_KEY, JSON.stringify(value));
}

export function consumePendingPropTradovateFlow() {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PENDING_FLOW_STORAGE_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(PENDING_FLOW_STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
