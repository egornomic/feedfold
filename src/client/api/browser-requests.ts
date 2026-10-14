import type { ApiInput, ApiOperation } from "../../shared/api/operations.js";

type BrowserRequest = {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: object | undefined;
};

function get(path: string): BrowserRequest {
  return { path, method: "GET" };
}

function post(path: string, body?: object): BrowserRequest {
  return { path, method: "POST", body };
}

function patch(path: string, body: object): BrowserRequest {
  return { path, method: "PATCH", body };
}

function remove(path: string): BrowserRequest {
  return { path, method: "DELETE" };
}

export const browserRequests: {
  [K in ApiOperation]: (payload: ApiInput<K>) => BrowserRequest;
} = {
  session: () => get("/api/auth/session"),
  login: (payload) => post("/api/auth/login", payload),
  register: (payload) => post("/api/auth/register", payload),
  passkeySignupOptions: (payload) => post("/api/auth/register/passkey/options", payload),
  completePasskeySignup: (payload) => post("/api/auth/register/passkey", payload),
  logout: () => post("/api/auth/logout"),
  authConfig: () => get("/api/auth/config"),
  invitations: () => get("/api/auth/invitations"),
  createInvitation: (payload) => post("/api/auth/invitations", payload),
  revokeInvitation: ({ id }) => remove(`/api/auth/invitations/${id}`),
  changePassword: (payload) => ({ path: "/api/auth/password", method: "PUT", body: payload }),
  removePassword: () => remove("/api/auth/password"),
  deleteAccount: () => remove("/api/auth/account"),
  passkeys: () => get("/api/auth/passkeys"),
  passkeyRegistrationOptions: () => post("/api/auth/passkeys/options"),
  registerPasskey: (payload) => post("/api/auth/passkeys", payload),
  renamePasskey: ({ id, ...body }) => patch(`/api/auth/passkeys/${encodeURIComponent(id)}`, body),
  deletePasskey: ({ id }) => remove(`/api/auth/passkeys/${encodeURIComponent(id)}`),
  stepUpPassword: (payload) => post("/api/auth/step-up/password", payload),
  stepUpPasskeyOptions: (payload) => post("/api/auth/step-up/passkey/options", payload),
  stepUpPasskey: (payload) => post("/api/auth/step-up/passkey", payload),
  passkeyAuthenticationOptions: () => post("/api/auth/passkey/options"),
  passkeyLogin: (payload) => post("/api/auth/passkey", payload),
  bootstrap: () => get("/api/bootstrap"),
  articles: (payload) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return get(`/api/articles?${query}`);
  },
  article: ({ id }) => get(`/api/articles/${id}`),
  telegramArticleMedia: ({ id }) => get(`/api/articles/${id}/telegram-media`),
  xArticleMedia: ({ id, postId }) => get(`/api/articles/${id}/x-media/${postId}`),
  loadFullContent: ({ id }) => post(`/api/articles/${id}/extract`),
  summarizeArticle: ({ id, ...body }) => post(`/api/articles/${id}/summary`, body),
  translateArticle: ({ id, ...body }) => post(`/api/articles/${id}/translation`, body),
  updateArticleState: ({ id, state }) => patch(`/api/articles/${id}/state`, state),
  markRead: (payload) => post("/api/articles/mark-read", payload),
  refresh: (payload) => post("/api/refresh", payload),
  discoverFeed: (payload) => post("/api/feeds/discover", payload),
  analyzeWebPage: (payload) => post("/api/web-feeds/analyze", payload),
  createFeed: (payload) => post("/api/feeds", payload),
  feed: ({ id }) => get(`/api/feeds/${id}`),
  updateFeed: ({ id, input }) => patch(`/api/feeds/${id}`, input),
  deleteFeed: ({ id }) => remove(`/api/feeds/${id}`),
  analyzeWebFeed: ({ id }) => post(`/api/feeds/${id}/web-feed/analyze`),
  updateWebFeedSelection: ({ id, ...body }) => patch(`/api/feeds/${id}/web-feed`, body),
  createFolder: (payload) => post("/api/folders", payload),
  updateFolder: ({ id, input }) => patch(`/api/folders/${id}`, input),
  deleteFolder: ({ id }) => remove(`/api/folders/${id}`),
  rules: () => get("/api/rules"),
  createRule: (payload) => post("/api/rules", payload),
  updateRule: ({ id, input }) => patch(`/api/rules/${id}`, input),
  deleteRule: ({ id }) => remove(`/api/rules/${id}`),
  updateSettings: (payload) => patch("/api/settings", payload),
  updateAiFeature: ({ feature, input }) => patch(`/api/ai/features/${feature}`, input),
  // The browser transport encrypts the key before it creates the request body.
  saveAiProviderKey: ({ provider }) => ({
    path: `/api/ai/providers/${provider}/key`,
    method: "PUT",
  }),
  deleteAiProviderKey: ({ provider }) => remove(`/api/ai/providers/${provider}/key`),
  importOpml: (payload) => post("/api/opml/import", payload),
  exportOpml: () => get("/api/opml/export"),
};
