import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  analyzeWebFeedDocument,
  extractWebFeedSelection,
  suggestedWebFeedCandidateIds,
} from "../../src/server/features/feeds/web/dom.js";

const PAGE_URL = "https://example.com/careers";

function documentFor(body: string, title = "Fixture"): Document {
  return new JSDOM(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    { url: PAGE_URL },
  ).window.document;
}

describe("web-feed DOM analysis", () => {
  it("discovers, ranks, and extracts repeated items without duplicate links", () => {
    const document = documentFor(`
      <nav><a href="/account">Account</a><a href="/settings">Settings</a></nav>
      <main>
        <h1>Careers</h1>
        <section id="openings" aria-label="Latest openings">
          <article class="job-card">
            <h2><a href="/jobs/alpha#overview">Alpha engineer</a></h2>
            <time datetime="2026-07-20T10:00:00Z">20 July</time>
            <span class="byline">Ada</span>
            <p class="summary">Build careful tools.</p>
            <img src="/images/alpha.jpg" alt="">
          </article>
          <article class="job-card">
            <h2><a href="/jobs/beta">Beta designer</a></h2>
            <time datetime="2026-07-21T11:30:00Z">21 July</time>
            <span class="byline">Grace</span>
            <p class="summary">Shape a calmer reader.</p>
            <img src="/images/beta.jpg" alt="">
          </article>
          <article class="job-card">
            <h2><a href="/jobs/gamma">Gamma researcher</a></h2>
            <span class="byline">Lin</span>
            <p class="summary">Explore useful signals.</p>
            <img src="/images/gamma.jpg" alt="">
          </article>
          <article class="job-card duplicate">
            <h2><a href="/jobs/alpha#apply">Alpha engineer application</a></h2>
            <p class="summary">The same role linked twice.</p>
          </article>
        </section>
      </main>
    `);

    const analysis = analyzeWebFeedDocument(document, PAGE_URL);
    const jobs = analysis.candidates.find(({ candidate }) => candidate.label === "Latest openings");
    expect(jobs?.candidate).toMatchObject({
      itemCount: 3,
      availableFields: ["title", "link", "date", "author", "summary", "image"],
      articles: [
        { title: "Alpha engineer" },
        { title: "Beta designer" },
        { title: "Gamma researcher" },
      ],
    });
    if (!jobs) throw new Error("Expected the job-card candidate");

    const extracted = extractWebFeedSelection(document, PAGE_URL, jobs.candidate.config.selectors);
    expect(extracted.articles.map((article) => article.externalId)).toEqual([
      "https://example.com/jobs/alpha",
      "https://example.com/jobs/beta",
      "https://example.com/jobs/gamma",
    ]);
    expect(extracted.articles[0]).toMatchObject({
      title: "Alpha engineer",
      author: "Ada",
      publishedAt: "2026-07-20T10:00:00.000Z",
      summary: "Build careful tools.",
      imageUrl: "https://example.com/images/alpha.jpg",
    });
    expect(extracted.articles[2]?.publishedAt).toBeNull();

    const saved = analyzeWebFeedDocument(document, PAGE_URL, jobs.candidate.config);
    expect(saved.savedCandidateId).toBe(jobs.candidate.id);
    expect(saved.candidates[0]?.candidate.label).toBe("Saved selection");
  });

  it("keeps web feed previews to the same three recent entries as published feeds", () => {
    const document = documentFor(`
      <section aria-label="Latest updates">
        ${Array.from(
          { length: 5 },
          (_, index) =>
            `<article><h2><a href="/updates/${index + 1}">Update ${index + 1}</a></h2></article>`,
        ).join("")}
      </section>
    `);

    const preview = analyzeWebFeedDocument(document, PAGE_URL).candidates.find(
      ({ candidate }) => candidate.label === "Latest updates",
    )?.candidate;

    expect(preview?.itemCount).toBe(5);
    expect(preview?.articles.map((article) => article.title)).toEqual([
      "Update 1",
      "Update 2",
      "Update 3",
    ]);
  });

  it("does not turn page headers into a feed when repeated content has no links", () => {
    const document = documentFor(`
      <div class="header-box row">
        <div><h1><a href="/">Quotes to Scrape</a></h1><p>Browse quotes</p></div>
        <div><a href="/login">Login</a><p>Account access</p></div>
      </div>
      <main id="quotes">
        ${Array.from(
          { length: 10 },
          (_, index) => `<div class="quote">
            <span class="text">Quote ${index + 1}</span>
            <small class="author">Author ${index + 1}</small>
          </div>`,
        ).join("")}
      </main>
    `);

    expect(analyzeWebFeedDocument(document, PAGE_URL).candidates).toEqual([]);
  });

  it("keeps low-confidence repeated groups selectable without suggesting them", () => {
    const document = documentFor(`
      <section id="news">
        <article><h2><a href="/news-one">News one</a></h2></article>
        <article><h2><a href="/news-two">News two</a></h2></article>
        <article><h2><a href="/news-three">News three</a></h2></article>
      </section>
      <section id="manual">
        <div><a href="/manual-one">Manual one</a></div>
        <div><a href="/manual-two">Manual two</a></div>
      </section>
    `);

    const { candidates } = analyzeWebFeedDocument(document, PAGE_URL);
    const manual = candidates.find(({ candidate }) =>
      candidate.articles.some((article) => article.url?.endsWith("/manual-one")),
    );
    const suggestedIds = suggestedWebFeedCandidateIds(candidates);

    expect(manual?.candidate.itemCount).toBe(2);
    expect(suggestedIds).not.toContain(manual?.candidate.id);
    expect(suggestedIds.length).toBeGreaterThan(0);
  });

  it("allows manual setup when every selectable group is below the suggestion threshold", () => {
    const document = documentFor(`
      <section>
        <div><a href="/one">Manual one</a></div>
        <div><a href="/two">Manual two</a></div>
      </section>
    `);

    const { candidates } = analyzeWebFeedDocument(document, PAGE_URL);
    const manual = candidates.find(({ candidate }) => candidate.itemCount === 2);

    expect(suggestedWebFeedCandidateIds(candidates)).toEqual([]);
    expect(manual?.candidate.articles.map((article) => article.title)).toEqual([
      "Manual one",
      "Manual two",
    ]);
  });

  it("reports malformed saved selectors without involving a browser", () => {
    const document = documentFor(`
      <main>
        <article><a href="/one">One</a></article>
        <article><a href="/two">Two</a></article>
      </main>
    `);

    expect(() =>
      extractWebFeedSelection(document, PAGE_URL, {
        item: "main >> invalid",
        link: "a",
        title: "a",
        date: null,
        author: null,
        summary: null,
        image: null,
      }),
    ).toThrowError(expect.objectContaining({ kind: "selection_broken" }));
  });
});
