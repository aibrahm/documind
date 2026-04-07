import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/clients";
import { webSearch } from "@/lib/web-search";
import { runFinancialModel } from "@/lib/tools/financial-model";
import { runFetchUrl } from "@/lib/tools/fetch-url";
import { runExtractKeyTerms } from "@/lib/tools/extract-key-terms";
import { runCompareDeals } from "@/lib/tools/compare-deals";

/**
 * Claude streaming with autonomous web_search tool use.
 *
 * The model can call `web_search` whenever it needs fresh external context
 * (current pricing, recent comparable deals, news on counterparties, etc).
 * The system runs Tavily, returns results, and the model continues — possibly
 * calling the tool again. After the model produces final text without tool
 * calls, that text is streamed to the user.
 *
 * Earlier turns (tool_use → tool_result rounds) are NOT streamed — only the
 * final answer reaches the UI. We do emit lightweight status events so the
 * client can show "Searching the web for X..." while a tool round is running.
 */

export interface AdditionalWebSource {
  id: string;
  type: "web";
  title: string;
  url: string;
}

interface RunOpts {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  // Called whenever a chunk of final text is produced
  onText: (delta: string) => void;
  // Called once per tool round so the UI can display status.
  // toolName lets the UI distinguish web_search vs fetch_url etc.
  onToolStart?: (query: string, toolName?: string) => void;
  onToolEnd?: (query: string, resultCount: number, toolName?: string) => void;
  // Called once at the end with the full text
  onComplete?: (fullText: string, additionalWebSources: AdditionalWebSource[]) => void;
  // Hard limit on tool rounds to prevent infinite loops
  maxToolRounds?: number;
}

const WEB_SEARCH_TOOL: Anthropic.Tool = {
  name: "web_search",
  description:
    "Search the public web for fresh external information. Use this autonomously whenever you need current data that the indexed corpus doesn't contain — for example: current commodity prices, recent comparable deals (KIZAD, JAFZA, Tangier MED, Suez SCZone), news about a counterparty company, recent regulatory changes, latest IFC project benchmarks, or any factual question requiring information beyond the user's documents. Do not ask the user for permission — just call this tool when you need fresh data.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "A focused search query in English or Arabic. Be specific. Examples: 'KIZAD East Port Said land lease pricing per square meter 2024', 'El Sewedy Electric financial performance 2024', 'Egyptian special economic zone law amendments 2024'",
      },
      reason: {
        type: "string",
        description: "One-line reason why you need this search (helps the user trust the result).",
      },
    },
    required: ["query"],
  },
};

const FINANCIAL_MODEL_TOOL: Anthropic.Tool = {
  name: "financial_model",
  description:
    "Run financial calculations with guaranteed correctness. Use this whenever the user's question involves NPV, IRR, payback period, or sensitivity analysis. DO NOT do arithmetic in your head — always call this tool for any non-trivial calculation involving cashflows, discount rates, or return metrics. Much more reliable than mental math.",
  input_schema: {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        enum: ["npv", "irr", "payback", "sensitivity"],
        description:
          "Which calculation to run. npv = net present value (needs discount_rate). irr = internal rate of return. payback = simple payback period in years. sensitivity = NPV sweep across a range of discount rates.",
      },
      cashflows: {
        type: "array",
        description:
          "Array of cash flows. Year 0 = today. Positive amounts = inflows to the authority. Negative = outflows. Use ONE consistent currency across all entries (convert first if needed).",
        items: {
          type: "object",
          properties: {
            year: { type: "number", description: "0 = today, 1 = one year from now, etc." },
            amount: { type: "number", description: "In the chosen currency. Negative = outflow." },
          },
          required: ["year", "amount"],
        },
      },
      discount_rate: {
        type: "number",
        description: "For NPV operation. Decimal form (0.12 = 12%). Default 0.12 if not provided.",
      },
      currency: {
        type: "string",
        description: "Optional ISO-like currency code (e.g. 'EGP', 'USD'). Echoed back in the result for clarity. All cashflows must already be in this currency.",
      },
      sensitivity: {
        type: "object",
        description: "For sensitivity operation only.",
        properties: {
          variable: { type: "string", enum: ["discount_rate"] },
          min: { type: "number", description: "Start of sweep range (decimal)" },
          max: { type: "number", description: "End of sweep range (decimal)" },
          steps: { type: "number", description: "Number of discrete points in the sweep" },
        },
      },
    },
    required: ["operation", "cashflows"],
  },
};

const FETCH_URL_TOOL: Anthropic.Tool = {
  name: "fetch_url",
  description:
    "Fetch the full text content of a specific URL — supports both HTML pages AND PDF files (extracted via pdf-parse). Use this after web_search when a search result looks promising but Tavily's snippet is too short to answer the question. DON'T use this for general research — prefer web_search first. Use fetch_url only when you've already found a specific URL and need its full content. Examples: an Elsewedy investor-relations page; an official decree PDF linked from a news article.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "A full http(s):// URL. Webpages and PDF files are both supported.",
      },
    },
    required: ["url"],
  },
};

const EXTRACT_KEY_TERMS_TOOL: Anthropic.Tool = {
  name: "extract_key_terms",
  description:
    "Read a project's linked documents (or a specific list of documents) and extract structured deal facts: land area, tenor, royalty, revenue share, equity split, milestones, governing law, etc. Optionally writes the extracted terms into a negotiation row's key_terms JSONB (additive merge — existing fields are preserved). Use this whenever the user wants to populate a negotiation from the source documents, or whenever you need a structured snapshot of what the deal actually says. DO NOT extract by hand — call this tool. The extracted output is more reliable than your own reading.",
  input_schema: {
    type: "object" as const,
    properties: {
      project: {
        type: "string",
        description:
          "Project slug or UUID. If provided, the tool reads ALL currently-linked documents for the project.",
      },
      document_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Explicit list of document UUIDs. Use this when the user pinned specific documents instead of working from a project.",
      },
      negotiation_id: {
        type: "string",
        description:
          "Optional: a negotiation UUID to merge the extracted terms into. The merge is ADDITIVE — existing key_terms fields are preserved unless the extraction provides a fresh value.",
      },
      focus: {
        type: "string",
        description:
          "Optional natural-language hint to narrow the extraction (e.g. 'focus on financial terms' or 'milestones and timelines only').",
      },
    },
  },
};

const COMPARE_DEALS_TOOL: Anthropic.Tool = {
  name: "compare_deals",
  description:
    "Side-by-side comparison of 2 to 5 negotiations across their key_terms fields. Returns a structured matrix where every unique field becomes a row and each negotiation becomes a column. Highlights which fields differ across scenarios. Use this whenever the user asks to compare scenarios, contrast deal structures, or review what changed between versions of a proposal. DO NOT manually re-state each negotiation's terms in narrative form when the user wants a comparison — call this tool to get a clean structured layout, then narrate the highlights.",
  input_schema: {
    type: "object" as const,
    properties: {
      negotiation_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Array of 2 to 5 negotiation UUIDs to compare. Order is preserved in the output columns.",
      },
    },
    required: ["negotiation_ids"],
  },
};

export async function runClaudeWithTools(opts: RunOpts): Promise<string> {
  const {
    systemPrompt,
    messages,
    temperature = 0.3,
    maxTokens = 8192,
    onText,
    onToolStart,
    onToolEnd,
    onComplete,
    maxToolRounds = 6,
  } = opts;

  const anthropic = getAnthropic();
  // Working message list — we append assistant tool_use blocks and user
  // tool_result blocks as we go. Anthropic accepts both string and block-array
  // content forms; we use block arrays once tools are involved.
  type Block =
    | { type: "text"; text: string }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
    | { type: "tool_result"; tool_use_id: string; content: string };

  const workingMessages: Array<{ role: "user" | "assistant"; content: string | Block[] }> = [
    ...messages,
  ];

  const additionalWebSources: AdditionalWebSource[] = [];
  let fullFinalText = "";
  let round = 0;

  while (round < maxToolRounds) {
    round++;

    // Stream a single round
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      tools: [
        WEB_SEARCH_TOOL,
        FINANCIAL_MODEL_TOOL,
        FETCH_URL_TOOL,
        EXTRACT_KEY_TERMS_TOOL,
        COMPARE_DEALS_TOOL,
      ],
      messages: workingMessages as Anthropic.MessageParam[],
    });

    // Collect tool_use blocks AND text from this round
    const assistantBlocks: Block[] = [];
    let currentTextBlock: { type: "text"; text: string } | null = null;
    let currentToolUse: {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      _inputJson: string;
    } | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "text") {
          currentTextBlock = { type: "text", text: "" };
        } else if (event.content_block.type === "tool_use") {
          currentToolUse = {
            type: "tool_use",
            id: event.content_block.id,
            name: event.content_block.name,
            input: {},
            _inputJson: "",
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta" && currentTextBlock) {
          currentTextBlock.text += event.delta.text;
          // Stream final text directly to the UI
          onText(event.delta.text);
          fullFinalText += event.delta.text;
        } else if (event.delta.type === "input_json_delta" && currentToolUse) {
          currentToolUse._inputJson += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentTextBlock) {
          assistantBlocks.push(currentTextBlock);
          currentTextBlock = null;
        } else if (currentToolUse) {
          try {
            const parsed = JSON.parse(currentToolUse._inputJson || "{}");
            currentToolUse.input = parsed;
          } catch {
            currentToolUse.input = { _raw: currentToolUse._inputJson };
          }
          // strip the helper field before passing on
          const { _inputJson, ...toolBlock } = currentToolUse;
          void _inputJson;
          assistantBlocks.push(toolBlock);
          currentToolUse = null;
        }
      }
    }

    // Append assistant turn to working messages
    workingMessages.push({ role: "assistant", content: assistantBlocks });

    // If there are no tool_use blocks, this round was the final answer — stop.
    const toolUses = assistantBlocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (toolUses.length === 0) break;

    // Run each tool in parallel and build tool_result blocks
    const toolResults: Block[] = await Promise.all(
      toolUses.map(async (tu): Promise<Block> => {
        // ── web_search ──
        if (tu.name === "web_search") {
          const query = (tu.input.query as string) || "";
          onToolStart?.(query, "web_search");
          try {
            const results = await webSearch(query, 5);
            for (const r of results) {
              const id = `WEB-${additionalWebSources.length + 1}`;
              additionalWebSources.push({
                id,
                type: "web",
                title: r.title,
                url: r.url,
              });
            }
            onToolEnd?.(query, results.length, "web_search");
            const resultText =
              results.length > 0
                ? results
                    .map(
                      (r, i) =>
                        `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`,
                    )
                    .join("\n\n")
                : "No results found.";
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(query, 0, "web_search");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Search failed: ${(err as Error).message}`,
            };
          }
        }

        // ── financial_model (instant, no UI status emit) ──
        if (tu.name === "financial_model") {
          try {
            const resultText = await runFinancialModel(tu.input);
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Calculation failed: ${(err as Error).message}`,
            };
          }
        }

        // ── fetch_url (slow, status visible to UI via onToolStart/End) ──
        if (tu.name === "fetch_url") {
          const url = (tu.input.url as string) || "";
          onToolStart?.(`Reading: ${url}`, "fetch_url");
          try {
            const resultText = await runFetchUrl(tu.input);
            const parsed = JSON.parse(resultText) as { ok?: boolean };
            onToolEnd?.(`Reading: ${url}`, parsed.ok ? 1 : 0, "fetch_url");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(`Reading: ${url}`, 0, "fetch_url");
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Fetch failed: ${(err as Error).message}`,
            };
          }
        }

        // ── extract_key_terms (slow — LLM + DB) ──
        if (tu.name === "extract_key_terms") {
          const label =
            (typeof tu.input.project === "string"
              ? `project: ${tu.input.project}`
              : null) ||
            (Array.isArray(tu.input.document_ids)
              ? `${(tu.input.document_ids as string[]).length} docs`
              : "documents");
          onToolStart?.(`Extracting key terms (${label})`, "extract_key_terms");
          try {
            const resultText = await runExtractKeyTerms(tu.input);
            const parsed = JSON.parse(resultText) as {
              document_count?: number;
              error?: string;
            };
            onToolEnd?.(
              `Extracting key terms (${label})`,
              parsed.document_count ?? 0,
              "extract_key_terms",
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            onToolEnd?.(
              `Extracting key terms (${label})`,
              0,
              "extract_key_terms",
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Extraction failed: ${(err as Error).message}`,
            };
          }
        }

        // ── compare_deals (instant DB read, no SSE event) ──
        if (tu.name === "compare_deals") {
          try {
            const resultText = await runCompareDeals(tu.input);
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: resultText,
            };
          } catch (err) {
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: `Compare failed: ${(err as Error).message}`,
            };
          }
        }

        // ── unknown tool name (shouldn't happen) ──
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: `Unknown tool: ${tu.name}`,
        };
      }),
    );

    // Append the user turn that contains the tool results
    workingMessages.push({ role: "user", content: toolResults });
    // Loop continues — Claude will see the tool results and continue reasoning
  }

  // If we hit the round limit without the model producing a final text-only
  // response, force one final call WITHOUT tools so the model has to write the
  // analysis using everything it gathered. This prevents the "I'll search
  // first" → endless tool calls → no final answer failure mode.
  const lastAssistant = workingMessages[workingMessages.length - 1];
  const lastWasTextOnly =
    lastAssistant?.role === "assistant" &&
    Array.isArray(lastAssistant.content) &&
    lastAssistant.content.every((b) => (b as Block).type === "text");
  if (!lastWasTextOnly) {
    // Add a system nudge as a final user message
    workingMessages.push({
      role: "user",
      content:
        "You've gathered enough information. Now produce the final analysis using everything you've learned. Do not call any more tools — write the complete answer directly. Respond in the user's original language. Use Arabic-Indic numerals if responding in Arabic.",
    });

    const finalStream = anthropic.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      // No tools — model must produce text
      messages: workingMessages as Anthropic.MessageParam[],
    });

    for await (const event of finalStream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onText(event.delta.text);
        fullFinalText += event.delta.text;
      }
    }
  }

  onComplete?.(fullFinalText, additionalWebSources);
  return fullFinalText;
}
