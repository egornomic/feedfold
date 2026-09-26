import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoData } from "../../src/demo/fixtures.js";
import { DemoStore } from "../../src/demo/store.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import type { ArticlePage } from "../../src/shared/types.js";
import { createTestApp } from "../helpers/app.js";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";

const feedHtml = `<p>hello <strong>world</strong> &amp; friends&nbsp;today</p>
  <p>Separate</p><p>paragraphs</p><p>inter<em>oper</em>able</p>
  <a href="https://attribute-only.test" title="attribute-secret">Link label</a>
  <p>Literal &lt;tag&gt; and 50%_done.</p>`;
const fullHtml = "<p>Extracted <em>body</em> &#169; 2026</p>";

describe.each(["server", "demo"] as const)("%s article text search", (mode) => {
  let search: (text: string) => Promise<ArticlePage>;
  let close = async () => {};

  beforeAll(async () => {
    if (mode === "demo") {
      const store = new DemoStore();
      const data = Reflect.get(store, "data") as DemoData;
      const article = data.articles[0];
      if (!article) throw new Error("Missing demo article fixture");
      Object.assign(article, { summary: "", feedContentHtml: feedHtml, contentHtml: fullHtml });
      data.articles = [article];
      search = async (text) => store.articles({ state: "all", search: text });
      return;
    }
    const database = new AppDatabase(":memory:");
    const server = await createTestApp(database, new AuthService(database.auth));
    close = async () => {
      await server.close();
      database.close();
    };
    const origin = await server.app.listen({ host: "127.0.0.1", port: 0 });
    const registration = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "search-reader", password: "reader-password" }),
    });
    expect(registration.status).toBe(201);
    const cookie = registration.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const { feed } = seedReaderBacklog(database, "Search examples", 1);
    database.connection
      .prepare("UPDATE articles SET summary = '', feed_content_html = ?, content_html = ?")
      .run(feedHtml, fullHtml);
    search = async (text) => {
      const query = new URLSearchParams({ state: "all", feedId: String(feed.id), search: text });
      const response = await fetch(`${origin}/api/articles?${query}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.json() as Promise<ArticlePage>;
    };
  });

  afterAll(async () => close());

  it.each([
    "hello world",
    "world & friends today",
    "Separate paragraphs",
    "interoperable",
    "Extracted body © 2026",
    "hello  \n world",
    "Link label",
    "Literal <tag>",
    "50%_done",
  ])("finds visible text: %s", async (text) => {
    expect((await search(text)).articles).toHaveLength(1);
  });

  it.each(["strong", "attribute-only", "attribute-secret", "amp;", "&#169;", "50%_missing"])(
    "does not match markup or an absent phrase: %s",
    async (text) => {
      expect((await search(text)).articles).toHaveLength(0);
    },
  );
});
