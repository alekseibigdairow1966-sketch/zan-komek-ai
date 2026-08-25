import { enrichAnalysisWithSearch } from "@/lib/confirm-sources-with-search";
import {
  DocumentTextExtractionError,
  extractDocumentText,
} from "@/lib/extract-document-text";
import { filterPromptSearchResults } from "@/lib/enrich-search-results";
import { buildLegalAnalysisPrompt } from "@/lib/legal-prompt";
import { callOpenAIResponses, OpenAIServiceError } from "@/lib/openai-client";
import { parseAnalysisResult } from "@/lib/parse-analysis-result";
import { retrieveLegalContext } from "@/lib/retrieve-legal-context";
import {
  retrySearchForModelActs,
  runLegalSourceSearch,
} from "@/lib/run-legal-source-search";
import type { LegalEmbeddingSearchResult } from "@/lib/search-legal-embedding-records";
import type {
  AnalysisRequest,
  AnalysisResponse,
  LegalSearchResult,
  PrimaryLegalAct,
  UserType,
} from "@/lib/types";
import { NextResponse } from "next/server";
import { LEGAL_AREAS, MIN_DESCRIPTION_LENGTH, USER_TYPES } from "@/lib/constants";

const USER_TYPE_VALUES = new Set<UserType>(USER_TYPES.map((type) => type.value));

const INVALID_REQUEST_MESSAGE =
  "Проверьте данные: выберите область права, тип пользователя, опишите ситуацию (минимум 20 символов) и подтвердите согласие";

function isUserType(value: string): value is UserType {
  return USER_TYPE_VALUES.has(value as UserType);
}

function isValidRequest(body: unknown): body is AnalysisRequest {
  if (!body || typeof body !== "object") return false;

  const data = body as Record<string, unknown>;

  return (
    typeof data.legalArea === "string" &&
    LEGAL_AREAS.includes(data.legalArea as AnalysisRequest["legalArea"]) &&
    typeof data.userType === "string" &&
    isUserType(data.userType) &&
    typeof data.description === "string" &&
    data.description.trim().length >= MIN_DESCRIPTION_LENGTH &&
    data.consent === true
  );
}

function isValidFormFields(input: {
  legalArea: FormDataEntryValue | null;
  userType: FormDataEntryValue | null;
  description: FormDataEntryValue | null;
  consent: FormDataEntryValue | null;
}): input is {
  legalArea: AnalysisRequest["legalArea"];
  userType: UserType;
  description: string;
  consent: FormDataEntryValue;
} {
  return (
    typeof input.legalArea === "string" &&
    LEGAL_AREAS.includes(input.legalArea as AnalysisRequest["legalArea"]) &&
    typeof input.userType === "string" &&
    isUserType(input.userType) &&
    typeof input.description === "string" &&
    input.consent === "true"
  );
}

async function parseJsonAnalysisRequest(
  request: Request,
): Promise<AnalysisRequest | NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректный формат запроса" },
      { status: 400 },
    );
  }

  if (!isValidRequest(body)) {
    return NextResponse.json(
      { error: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  return {
    legalArea: body.legalArea,
    userType: body.userType,
    description: body.description.trim(),
    consent: true,
  };
}

async function parseMultipartAnalysisRequest(
  request: Request,
): Promise<AnalysisRequest | NextResponse> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Некорректный формат запроса" },
      { status: 400 },
    );
  }

  const legalArea = formData.get("legalArea");
  const userType = formData.get("userType");
  const description = formData.get("description");
  const consent = formData.get("consent");
  const document = formData.get("document");

  if (!isValidFormFields({ legalArea, userType, description, consent })) {
    return NextResponse.json(
      { error: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const validatedLegalArea = legalArea as AnalysisRequest["legalArea"];
  const validatedUserType = userType as UserType;
  const validatedDescription = (description as string).trim();

  if (!(document instanceof File)) {
    return NextResponse.json(
      { error: "Поле document должно содержать файл DOCX" },
      { status: 400 },
    );
  }

  try {
    const extracted = await extractDocumentText({
      data: await document.arrayBuffer(),
      mimeType: document.type,
      fileName: document.name,
    });

    const descriptionParts = [
      validatedDescription,
      "ТЕКСТ ЗАГРУЖЕННОГО ДОКУМЕНТА:",
      extracted.text,
    ].filter(Boolean);

    const combinedDescription = descriptionParts.join("\n\n");

    return {
      legalArea: validatedLegalArea,
      userType: validatedUserType,
      description: combinedDescription,
      consent: true,
    };
  } catch (error) {
    if (error instanceof DocumentTextExtractionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    throw error;
  }
}

export async function resolveAnalysisRequest(
  request: Request,
): Promise<AnalysisRequest | NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    return parseMultipartAnalysisRequest(request);
  }

  return parseJsonAnalysisRequest(request);
}

interface AnalyzeSearchOutcome {
  results: LegalSearchResult[];
  performed: boolean;
  primary_legal_act?: PrimaryLegalAct;
}

export interface AnalyzeHandlerDependencies {
  /** Semantic context only; never a source of verification. */
  retrieveLegalContext: (input: {
    legalArea: string;
    userType: string;
    description: string;
  }) => Promise<LegalEmbeddingSearchResult[]>;
  callAnalysis: (prompt: string) => Promise<string>;
  searchLegalSources: (input: {
    legalArea: string;
    userType: string;
    description: string;
  }) => Promise<AnalyzeSearchOutcome>;
}

// Retrieval stays inert until the embedding artifact is configured: without
// it retrieveLegalContext returns [] and builds no OpenAI client.
const defaultDependencies: AnalyzeHandlerDependencies = {
  retrieveLegalContext,
  callAnalysis: callOpenAIResponses,
  searchLegalSources: runLegalSourceSearch,
};

export function createAnalyzeHandler(
  dependencies: AnalyzeHandlerDependencies = defaultDependencies,
) {
  return async function handleAnalyze(request: Request) {
    const resolved = await resolveAnalysisRequest(request);

    if (resolved instanceof NextResponse) {
      return resolved;
    }

    const analysisRequest = resolved;

    try {
      // Retrieval is auxiliary: a failure degrades to the previous flow
      // instead of failing the request. Errors of the analysis and search
      // layers keep propagating as before.
      let retrievedContext: LegalEmbeddingSearchResult[] = [];

      try {
        retrievedContext = await dependencies.retrieveLegalContext({
          legalArea: analysisRequest.legalArea,
          userType: analysisRequest.userType,
          description: analysisRequest.description,
        });
      } catch (error) {
        console.error(
          "Legal context retrieval failed, continuing without it:",
          error instanceof Error ? error.message : error,
        );
      }

      const searchOutcome = await dependencies.searchLegalSources({
        legalArea: analysisRequest.legalArea,
        userType: analysisRequest.userType,
        description: analysisRequest.description,
      });

      const promptResults = filterPromptSearchResults(searchOutcome.results);

      const content = await dependencies.callAnalysis(
        buildLegalAnalysisPrompt(
          analysisRequest,
          promptResults,
          searchOutcome.primary_legal_act,
          retrievedContext,
        ),
      );

      const parsed = parseAnalysisResult(content);

      const modelActNames = parsed.applicableLaws.map((law) => law.act_name);
      const searchResults = searchOutcome.performed
        ? await retrySearchForModelActs({
            actNames: modelActNames,
            description: analysisRequest.description,
            legalArea: analysisRequest.legalArea,
            existingResults: searchOutcome.results,
          })
        : searchOutcome.results;

      const finalPromptResults = filterPromptSearchResults(searchResults);

      const result = enrichAnalysisWithSearch(
        parsed,
        finalPromptResults,
        searchOutcome.performed,
        searchOutcome.primary_legal_act,
      );

      const response: AnalysisResponse = { result };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof OpenAIServiceError) {
        console.error("OpenAI error:", error.message);
        return NextResponse.json(
          { error: error.message },
          { status: error.status },
        );
      }

      if (error instanceof SyntaxError) {
        console.error("Invalid model JSON:", error.message);
        return NextResponse.json(
          { error: "Модель вернула некорректный JSON. Попробуйте ещё раз" },
          { status: 502 },
        );
      }

      console.error("Analysis error:", error);

      const message =
        error instanceof Error ? error.message : "Внутренняя ошибка сервера";

      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const POST = createAnalyzeHandler();
