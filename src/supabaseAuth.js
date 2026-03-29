const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AUTH_STORAGE_KEY = "helix.supabase.auth.session.v1";
const SUPABASE_PROFILE_TABLE = "user_profiles";

function createAuthClient() {
  let currentSession = null;
  const listeners = new Set();

  const emit = (event, session) => {
    listeners.forEach((listener) => {
      listener(event, session);
    });
  };

  const persistSession = (session) => {
    currentSession = session || null;
    if (typeof window === "undefined") return;
    if (!session) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  };

  const readSession = () => {
    if (currentSession) return currentSession;
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      currentSession = parsed && typeof parsed === "object" ? parsed : null;
      return currentSession;
    } catch {
      return null;
    }
  };

  const requestAuth = async (path, body, accessToken = "") => {
    const response = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.msg || payload?.error_description || payload?.error || "Supabase auth request failed.");
    }
    return payload;
  };

  const requestRest = async ({ path, method = "GET", accessToken = "", body, query = "" }) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}${query}`, {
      method,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `Supabase REST request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  };

  return {
    auth: {
      async getSession() {
        return { data: { session: readSession() } };
      },
      async signUp({ email, password }) {
        const payload = await requestAuth("signup", { email, password });
        const session = payload?.access_token ? payload : null;
        if (session) {
          persistSession(session);
          emit("SIGNED_IN", session);
        }
        return { data: payload, error: null };
      },
      async signInWithPassword({ email, password }) {
        const payload = await requestAuth("token?grant_type=password", { email, password });
        persistSession(payload);
        emit("SIGNED_IN", payload);
        return { data: payload, error: null };
      },
      async signOut() {
        const session = readSession();
        if (session?.access_token) {
          try {
            await requestAuth("logout", {}, session.access_token);
          } catch {
            // Keep local sign-out reliable even if remote logout fails.
          }
        }
        persistSession(null);
        emit("SIGNED_OUT", null);
        return { error: null };
      },
      onAuthStateChange(callback) {
        listeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe() {
                listeners.delete(callback);
              },
            },
          },
        };
      },
    },
    profile: {
      async fetchByUserId({ userId, accessToken }) {
        if (!userId || !accessToken) throw new Error("Missing Supabase profile fetch inputs.");
        const encodedUserId = encodeURIComponent(userId);
        const data = await requestRest({
          path: SUPABASE_PROFILE_TABLE,
          method: "GET",
          accessToken,
          query: `?select=*&user_id=eq.${encodedUserId}&limit=1`,
        });
        return Array.isArray(data) ? data[0] || null : null;
      },
      async upsertByUserId({ userId, accessToken, profile }) {
        if (!userId || !accessToken) throw new Error("Missing Supabase profile upsert inputs.");
        const [record] = await requestRest({
          path: SUPABASE_PROFILE_TABLE,
          method: "POST",
          accessToken,
          query: "?on_conflict=user_id",
          body: [{ user_id: userId, profile_data: profile }],
        });
        return record || null;
      },
    },
  };
}

const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured ? createAuthClient() : null;

export function isAuthConfigured() {
  return isSupabaseConfigured;
}

export function getSupabaseProfileTableName() {
  return SUPABASE_PROFILE_TABLE;
}
