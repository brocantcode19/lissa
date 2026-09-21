/**
 * Typed API client for LISSA.
 * All calls go through /api/proxy/* which Next.js rewrites to FastAPI.
 */

const BASE = "/api/proxy";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",          // Always send cookies
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export const api = {
  auth: {
    login: (email_address: string, password: string) =>
      request<{ message: string; role: string; full_name: string }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email_address, password }) }
      ),

    logout: () =>
      request<{ message: string }>("/auth/logout", { method: "POST" }),

    me: () =>
      request<{ user_id: string; full_name: string; role_id: string; email_address: string }>(
        "/auth/me"
      ),

    register: (full_name: string, email_address: string, password: string) =>
      request<{ message: string; user_id: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ full_name, email_address, password }),
      }),
  },

  // ── Week 2: Query pipeline ─────────────────────────────────────────────────
  // query: {
  //   ask: (question: string) =>
  //     request<QueryResponse>("/query", {
  //       method: "POST",
  //       body: JSON.stringify({ question }),
  //     }),
  // },

  // ── Week 2: Document management ────────────────────────────────────────────
  // documents: {
  //   list: () => request<Document[]>("/documents"),
  //   upload: (formData: FormData) =>
  //     fetch(`${BASE}/documents`, { method: "POST", credentials: "include", body: formData })
  //       .then(r => r.json()),
  // },
};
