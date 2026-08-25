export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export const LEGAL_SYSTEM_INSTRUCTIONS =
  "Ты юридический AI-помощник по законодательству Республики Казахстан. Отвечай только валидным JSON.";

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
}
