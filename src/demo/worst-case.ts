import type { Article, Feed, Rule } from "../shared/types.js";
import { createDemoData, type DemoData } from "./fixtures.js";

export const DATA_MODES = ["demo", "worst", "empty", "one", "huge"] as const;
export type DataMode = (typeof DATA_MODES)[number];

const PROMPT_ID = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const LONG_URL =
  "https://example.com/workspaces/northwind-industries-holdings/projects/accessible-public-services/research/quarterly-review-2026-10-02?tab=comments&filter=unresolved";
const EMAIL = "bartholomew.fitzgerald@northwind-industries-holdings.example.com";

function svgImage(width: number, height: number, content: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`)}`;
}

const WIDE_IMAGE = svgImage(
  4_000,
  200,
  '<rect width="4000" height="200" fill="#87a2a8"/><path d="M0 180L400 30L800 140L1400 10L2200 170L2900 40L4000 180V200H0Z" fill="#354e46"/>',
);
const TALL_IMAGE = svgImage(
  200,
  4_000,
  '<rect width="200" height="4000" fill="#c8b896"/><path d="M75 0H125V4000H75Z" fill="#506652"/><path d="M0 1800H200V2100H0Z" fill="#96764b"/>',
);
const TRANSPARENT_IMAGE = svgImage(
  600,
  200,
  '<text x="20" y="110" font-family="serif" font-size="42" fill="#161616">NORTHWIND JOURNAL</text>',
);

const LONG_PROMPT = [
  "Prepare a research briefing for a reader comparing evidence across disciplines. Start with a short overview, then give the article’s central claim and explain the evidence the author uses to support it.",
  "Separate observed results from interpretation, predictions, recommendations and personal opinions. Preserve the names of institutions, study populations, publication dates and units of measurement. Explain technical terms on first use.",
  "Describe the study design, sample size, comparison groups, measurement methods and time period. Identify whether the source is a controlled experiment, observational study, systematic review, commentary or report of preliminary findings.",
  "Describe limitations that materially change how the findings should be used. Include uncertainty, missing context, conflicts of interest, funding sources, selection bias and differences between the studied population and the people affected by the proposed recommendation.",
  "When several claims depend on the same source, group them together. Preserve links to primary evidence. Say when the article does not provide enough information to assess a claim; do not invent missing evidence or make a claim stronger than the source supports.",
  "End with practical next steps for an independent reader: what to verify, which original research to read, what would change the conclusion and which questions remain unanswered. Use clear headings and concise paragraphs rather than a long uninterrupted list.",
].join("\n\n");

function video(viewCount: number, type: "video" | "short" = "video"): Article["media"] {
  return {
    provider: "youtube",
    type,
    embedUrl: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
    thumbnailUrl: WIDE_IMAGE,
    viewCount,
  };
}

function oneData(data: DemoData): DemoData {
  data.folders = data.folders.filter((folder) => folder.id === 1);
  data.feeds = data.feeds.filter((feed) => feed.id === 1);
  data.articles = data.articles
    .filter((article) => article.id === 1)
    .map((article) => ({
      ...article,
      title: "J",
      author: "Jo",
      summary: "One short update from one subscription.",
      imageUrl: null,
      media: video(1),
      isRead: false,
      isSaved: true,
      aiSummary: null,
    }));
  data.rules = data.rules.filter((rule) => rule.id === 1);
  for (const folder of data.folders) folder.unreadCount = 1;
  for (const feed of data.feeds) {
    feed.unreadCount = 1;
    feed.totalCount = 1;
  }
  for (const rule of data.rules) rule.matchedCount = 1;
  return data;
}

function worstData(data: DemoData, now: Date): DemoData {
  // API limits: feed title 300, folder/rule name 200, custom prompt name 80.
  const feedNames = [
    "International Journal of Human-Computer Studies — Research in Human Factors, Cognitive Science, Artificial Intelligence, Design and Socio-Technical Systems: Special Issue on Sustainable Digital Infrastructure, Accessibility and Inclusive Interaction Across Public Services and Community Institutions Worldwide".slice(
      0,
      300,
    ),
    "Benachrichtigungseinstellungen",
    "Đặng Thị Ngọc Hân — nghiên cứu và thiết kế",
    "王秀英的设计与科技笔记",
    "نور الهدى عبد الرحمن — أخبار المجتمع",
    "👩🏽‍💻 Priya’s engineering notes",
    "J",
    "Signal & Craft <b>research</b> &amp; **notes**",
  ];
  data.feeds = data.feeds.map((feed, index) => ({
    ...feed,
    title: feedNames[index] ?? feed.title,
    feedUrl: `https://example.com/publications/${feed.id}/research-and-community-dispatch/feed.xml`,
    siteUrl: index === 6 ? null : LONG_URL,
    healthStatus: index === 1 ? "failing" : index === 2 ? "needs_attention" : "healthy",
    lastErrorKind: index === 1 ? "http" : index === 2 ? "selection_broken" : null,
    lastError:
      index === 1
        ? `The source returned HTTP 503 while loading ${LONG_URL}. Try refreshing after the publisher’s maintenance window.`
        : index === 2
          ? "The selected article group no longer matches this page. The publisher moved its updates into a new section; choose the new group to resume this subscription."
          : null,
    lastHttpStatus: index === 1 ? 503 : 200,
    lastSuccessAt: index === 1 ? null : feed.lastSuccessAt,
    lastMatchCount: index === 2 ? 0 : feed.lastMatchCount,
    sourceKind: index === 2 ? "web" : feed.sourceKind,
    paused: index === 3,
    refreshing: index === 4,
  }));
  data.folders = data.folders.map((folder, index) => ({
    ...folder,
    name:
      index === 0
        ? "Research and reference material for accessible public services — international standards, community consultations, procurement decisions, independent evaluations, implementation notes and quarterly follow-up reports".slice(
            0,
            200,
          )
        : index === 1
          ? "Paramètres de confidentialité et de sécurité"
          : folder.name,
  }));
  const feedsById = new Map(data.feeds.map((feed) => [feed.id, feed]));
  // Ingested article titles/bylines have no length limit; summaries are capped at 1,000.
  const variants: Array<Partial<Article>> = [
    {
      title:
        "A comprehensive review of accessible public services: evidence from international research, community-led evaluations, procurement decisions and the practical consequences of maintaining digital infrastructure across languages and generations",
      author: EMAIL,
      imageUrl: "/__break-ui-missing.png",
      url: LONG_URL,
    },
    { title: "Benachrichtigungseinstellungen", author: "J", imageUrl: null },
    {
      title: "Đặng Thị Ngọc Hân — thiết kế cho cộng đồng",
      author: "Đặng Thị Ngọc Hân",
      imageUrl: WIDE_IMAGE,
    },
    { title: "王秀英：让每个人都能使用公共服务", author: "王秀英", imageUrl: TALL_IMAGE },
    {
      title: "نور الهدى عبد الرحمن — تصميم الخدمات العامة",
      author: "نور الهدى عبد الرحمن",
      imageUrl: TRANSPARENT_IMAGE,
    },
    {
      title: "👩🏽‍💻 Priya — keeping community tools maintainable",
      author: "👩🏽‍💻 Priya",
      imageUrl: null,
    },
    {
      title: "",
      summary: "A titleless field note with a useful description.",
      author: null,
      url: null,
    },
    { title: "", summary: "", author: null, feedContentHtml: null, contentHtml: null },
    { title: "   ", summary: "   ", author: null, feedContentHtml: null, contentHtml: null },
    {
      title: "Literal <b>research</b>, &amp; notation and **emphasis**",
      author: "Seán O'Brien-Ó Súilleabháin",
    },
    {
      title: LONG_URL,
      summary: `Source references and unresolved review notes: ${LONG_URL}`,
      author: "Christopher Alexander Montgomery III",
    },
    { title: "A newly published video", media: video(1), author: "Jo" },
    { title: "A short community update", media: video(1_284_000, "short"), author: null },
    {
      title: "A scheduled research note",
      publishedAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      author: "Ólafur Darri Ólafsson",
    },
    { title: "An undated community archive", publishedAt: null, author: null, imageUrl: null },
    {
      title: "A historical archive imported from a publisher",
      publishedAt: "1970-01-01T00:00:00.000Z",
      author: "María José de la Cruz y Fernández",
    },
    {
      title: "A saved article from a removed subscription",
      feedId: null,
      folderId: null,
      feedTitle: LONG_URL,
      isSaved: true,
      author: "Konstantin Oberhauser-Wettstein",
    },
  ];
  const statuses: Article["extractionStatus"][] = [
    "complete",
    "feed",
    "pending",
    "processing",
    "failed",
  ];
  data.articles = data.articles.map((article, index) => {
    const feed = feedsById.get(article.feedId ?? -1);
    const extractionStatus = statuses[index % statuses.length] ?? "feed";
    const summary =
      index === 0
        ? `${LONG_PROMPT}\n\nRelated material: ${LONG_URL}`.slice(0, 1_000)
        : article.summary;
    return {
      ...article,
      // Keep the first stress row pinned, as the normal release row is in the demo.
      id: index === 0 ? 17 : 1_000 + index,
      feedTitle: feed?.title ?? article.feedTitle,
      feedSourceKind: feed?.sourceKind ?? article.feedSourceKind,
      publishedAt: new Date(now.getTime() - index * 3_600_000).toISOString(),
      discoveredAt: new Date(now.getTime() - index * 3_600_000).toISOString(),
      summary,
      imageUrl: null,
      extractionStatus,
      extractionError:
        extractionStatus === "failed"
          ? `The publisher’s article at ${LONG_URL} could not be loaded. The feed text is still available below.`
          : null,
      contentHtml: extractionStatus === "complete" ? article.contentHtml : null,
      contentSource: extractionStatus === "complete" ? article.contentSource : null,
      isRead: index === 15,
      isSaved: index === 0 || index === 16,
      aiSummary:
        index === 0
          ? {
              text: LONG_PROMPT,
              promptId: PROMPT_ID,
              provider: "openai",
              model: "demo",
              sourceKind: "full",
              generatedAt: now.toISOString(),
              usage: { inputTokens: null, outputTokens: null },
              grounding: null,
            }
          : null,
      ...variants[index],
    };
  });
  const ruleBase = data.rules.find((rule) => rule.id === 1);
  if (ruleBase) {
    data.rules = [
      {
        ...ruleBase,
        name: "Hide paid partnerships, sponsored announcements and recruitment campaigns from enterprise publications while retaining independent evaluations, accessibility research, community consultations and methodological follow-up notes".slice(
          0,
          200,
        ),
        conditions: [
          { field: "title", pattern: "sponsored|paid partnership|partner announcement" },
          { field: "author", pattern: EMAIL },
          { field: "summary", pattern: LONG_URL },
        ],
        conditionOperator: "or",
        action: "hide",
        matchedCount: 1_284,
      },
      {
        ...ruleBase,
        id: 2,
        name: "Keep independent research — 王秀英 / Đặng Thị Ngọc Hân",
        conditions: [
          { field: "any", pattern: "independent research" },
          { field: "content", pattern: "methods|limitations|reproducibility" },
        ],
        conditionOperator: "and",
        action: "keep",
        matchedCount: 1,
      },
      {
        ...ruleBase,
        id: 3,
        name: "Archive short videos",
        conditions: [{ field: "media", pattern: "short" }],
        action: "mark_read",
        enabled: false,
        matchedCount: 0,
      },
    ] satisfies Rule[];
  }
  data.settings.customPrompts = [
    {
      id: PROMPT_ID,
      name: "Research briefing — methods, limitations, funding, reproducibility and next steps for review".slice(
        0,
        80,
      ),
      prompt: LONG_PROMPT,
    },
    { id: "a2d98c9f-1c18-4f5e-a2c7-8818db76f5be", name: "J", prompt: "Give one useful takeaway." },
  ];
  data.settings.translationLanguage =
    "Brazilian Portuguese (preserve names, technical terms and original citations)";
  return data;
}

function hugeData(data: DemoData, now: Date): DemoData {
  const feedBase = data.feeds.find((feed) => feed.id === 1);
  const articleBase = data.articles.find((article) => article.id === 1);
  if (!feedBase || !articleBase) return data;
  const subjects = [
    "Design",
    "Climate",
    "Public services",
    "Accessibility",
    "Open source",
    "Science",
    "Community networks",
    "Architecture",
    "Independent publishing",
    "Technology",
  ];
  data.feeds = Array.from(
    // Desktop subscriptions are unlimited; hosted accounts default to 300.
    { length: 1_284 },
    (_, index): Feed => ({
      ...feedBase,
      id: index + 1,
      folderId: data.folders[index % data.folders.length]?.id ?? null,
      title: `${subjects[index % subjects.length]} — regional research dispatch ${Math.floor(index / subjects.length) + 1}`,
      feedUrl: `https://example.com/publications/${index + 1}/feed.xml`,
      siteUrl: `https://example.com/publications/${index + 1}`,
    }),
  );
  data.articles = Array.from({ length: 1_284 }, (_, index): Article => {
    const feed = data.feeds[index % data.feeds.length] ?? feedBase;
    return {
      ...articleBase,
      id: 10_000 + index,
      feedId: feed.id,
      feedTitle: feed.title,
      folderId: feed.folderId,
      title: `Research update ${index + 1}: lessons from accessible community infrastructure`,
      url: `https://example.com/research/updates/${index + 1}`,
      publishedAt: new Date(now.getTime() - index * 3_600_000).toISOString(),
      discoveredAt: new Date(now.getTime() - index * 3_600_000).toISOString(),
      imageUrl: null,
      isRead: false,
      isSaved: index < 1_000,
      aiSummary: null,
    };
  });
  return data;
}

export function createStressData(mode: DataMode, now = new Date()): DemoData {
  const data = createDemoData(now);
  if (mode === "empty") return { ...data, articles: [], feeds: [], folders: [], rules: [] };
  if (mode === "one") return oneData(data);
  if (mode === "worst" || mode === "huge") {
    const fixture = mode === "worst" ? worstData(data, now) : hugeData(data, now);
    for (const feed of fixture.feeds) {
      const articles = fixture.articles.filter((article) => article.feedId === feed.id);
      feed.totalCount = articles.length;
      feed.unreadCount = articles.filter((article) => !article.isRead).length;
    }
    return fixture;
  }
  return data;
}
