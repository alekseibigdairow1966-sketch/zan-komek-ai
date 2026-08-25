import OpenAI from "openai";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  OpenAIError,
  RateLimitError,
} from "openai";
import { getOpenAIModel, LEGAL_SYSTEM_INSTRUCTIONS } from "./openai-config";

export class OpenAIServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenAIServiceError";
  }
}

export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new OpenAIServiceError(
      "Сервис AI не настроен. Добавьте OPENAI_API_KEY в файл .env.local",
      503,
    );
  }

  return new OpenAI({ apiKey });
}

function mapOpenAIError(error: unknown): OpenAIServiceError {
  if (error instanceof AuthenticationError) {
    return new OpenAIServiceError(
      "Неверный API-ключ OpenAI. Проверьте OPENAI_API_KEY в .env.local",
      401,
    );
  }

  if (error instanceof RateLimitError) {
    return new OpenAIServiceError(
      "Недостаточно средств или превышен лимит запросов OpenAI. Попробуйте позже",
      429,
    );
  }

  if (error instanceof NotFoundError) {
    return new OpenAIServiceError(
      "Указанная модель недоступна. Проверьте значение OPENAI_MODEL",
      404,
    );
  }

  if (error instanceof BadRequestError) {
    const message = error.message.toLowerCase();

    if (message.includes("model") && message.includes("not")) {
      return new OpenAIServiceError(
        "Указанная модель недоступна. Проверьте значение OPENAI_MODEL",
        404,
      );
    }

    return new OpenAIServiceError(
      "Некорректный запрос к OpenAI. Проверьте настройки сервиса",
      400,
    );
  }

  if (
    error instanceof InternalServerError ||
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError
  ) {
    return new OpenAIServiceError(
      "Ошибка провайдера OpenAI. Попробуйте позже",
      502,
    );
  }

  if (error instanceof OpenAIError) {
    return new OpenAIServiceError(
      "Не удалось получить ответ от AI-сервиса. Попробуйте позже",
      502,
    );
  }

  if (error instanceof OpenAIServiceError) {
    return error;
  }

  return new OpenAIServiceError("Внутренняя ошибка сервера", 500);
}

export async function callOpenAIResponses(userPrompt: string): Promise<string> {
  try {
    const client = createOpenAIClient();
    const response = await client.responses.create({
      model: getOpenAIModel(),
      instructions: LEGAL_SYSTEM_INSTRUCTIONS,
      input: userPrompt,
      text: {
        format: { type: "json_object" },
      },
    });

    const content = response.output_text?.trim();

    if (!content) {
      throw new OpenAIServiceError("AI-сервис вернул пустой ответ", 502);
    }

    return content;
  } catch (error) {
    throw mapOpenAIError(error);
  }
}
