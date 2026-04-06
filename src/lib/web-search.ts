const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

/**
 * Search the web using Tavily API for PUBLIC data enrichment.
 * Returns clean text extracts, not HTML.
 */
export async function webSearch(query: string, maxResults = 3): Promise<WebSearchResult[]> {
  if (!TAVILY_API_KEY) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();

    return (data.results || []).map((r: { title: string; url: string; content: string; score: number }) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));
  } catch {
    return [];
  }
}
