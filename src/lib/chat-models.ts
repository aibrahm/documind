export const CHAT_MODEL_CHOICES = [
  "auto",
  "gpt-5.4",
  "claude-opus-4-6",
] as const;

export type ChatModelChoice = (typeof CHAT_MODEL_CHOICES)[number];

export function isChatModelChoice(value: unknown): value is ChatModelChoice {
  return (
    typeof value === "string" &&
    CHAT_MODEL_CHOICES.includes(value as ChatModelChoice)
  );
}

export function getChatModelLabel(model: ChatModelChoice): string {
  switch (model) {
    case "gpt-5.4":
      return "GPT-5.4";
    case "claude-opus-4-6":
      return "Claude Opus 4.6";
    default:
      return "Auto";
  }
}
