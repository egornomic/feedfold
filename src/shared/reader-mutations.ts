import type { ApiOperation } from "./api/operations.js";

/** Management operations whose committed changes must reach every open reader for the account. */
export const readerMutationRoutes = {
  createFeed: "POST /api/feeds",
  updateFeed: "PATCH /api/feeds/:id",
  deleteFeed: "DELETE /api/feeds/:id",
  updateWebFeedSelection: "PATCH /api/feeds/:id/web-feed",
  createFolder: "POST /api/folders",
  updateFolder: "PATCH /api/folders/:id",
  deleteFolder: "DELETE /api/folders/:id",
  createRule: "POST /api/rules",
  updateRule: "PATCH /api/rules/:id",
  deleteRule: "DELETE /api/rules/:id",
  updateSettings: "PATCH /api/settings",
  importOpml: "POST /api/opml/import",
} satisfies Partial<Record<ApiOperation, string>>;
