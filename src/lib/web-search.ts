const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

// Simple heuristic: news/current-events queries benefit from Tavily's
// `topic: "news"` mode + "advanced" depth, which returns article bodies instead
// of landing pages. Everything else uses general search.
function isNewsQuery(query: string): boolean {
  const q = query.toLowerCase();
  return /\b(news|latest|today|breaking|current|headline|happening|recent)\b|أخبار|آخر|اليوم|عاجل/.test(
    q,
  );
}

/**
 * Search the web using Tavily API for PUBLIC data enrichment.
 * Returns clean text extracts, not HTML.
 *
 * Fail-loud per CLAUDE.md: no silent fallback to `[]`. If Tavily is
 * unreachable or returns an error, throw so the caller can surface the
 * degraded state to the user instead of producing a fake "I don't know"
 * answer.
 */
export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  if (!TAVILY_API_KEY) {
    throw new Error("webSearch: TAVILY_API_KEY not configured");
  }
  if (!query || !query.trim()) {
    throw new Error("webSearch: empty query");
  }

  const news = isNewsQuery(query);

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      max_results: maxResults,
      search_depth: news ? "advanced" : "basic",
      topic: news ? "news" : "general",
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`webSearch: Tavily ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title: string; url: string; content: string; score: number }>;
  };

  const results: WebSearchResult[] = (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));

  // Prepend Tavily's synthesized answer as a pseudo-result so the LLM has a
  // ready-made summary to ground its response in. Labeled so the model can
  // distinguish it from a real source.
  if (data.answer && data.answer.trim()) {
    results.unshift({
      title: "Tavily synthesized answer",
      url: "tavily://answer",
      content: data.answer.trim(),
      score: 1,
    });
  }

  return results;
}
