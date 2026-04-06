import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/clients";
import { webSearch } from "@/lib/web-search";

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
  // Called once per tool round so the UI can display status
  onToolStart?: (query: string) => void;
  onToolEnd?: (query: string, resultCount: number) => void;
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
    | { type: "tool_use"; id: string; name: string; input: { query: string; reason?: string } }
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
      tools: [WEB_SEARCH_TOOL],
      messages: workingMessages as Anthropic.MessageParam[],
    });

    // Collect tool_use blocks AND text from this round
    const assistantBlocks: Block[] = [];
    let currentTextBlock: { type: "text"; text: string } | null = null;
    let currentToolUse: {
      type: "tool_use";
      id: string;
      name: string;
      input: { query: string; reason?: string };
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
            input: { query: "" },
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
            currentToolUse.input = { query: currentToolUse._inputJson };
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
      toolUses.map(async (tu) => {
        const query = tu.input.query || "";
        onToolStart?.(query);
        try {
          const results = await webSearch(query, 5);
          // Add to the unified web sources list returned to the caller
          for (const r of results) {
            const id = `WEB-${additionalWebSources.length + 1}`;
            additionalWebSources.push({ id, type: "web", title: r.title, url: r.url });
          }
          onToolEnd?.(query, results.length);
          const resultText =
            results.length > 0
              ? results
                  .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
                  .join("\n\n")
              : "No results found.";
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: resultText,
          };
        } catch (err) {
          onToolEnd?.(query, 0);
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `Search failed: ${(err as Error).message}`,
          };
        }
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
