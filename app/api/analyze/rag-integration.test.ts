import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichAnalysisWithSearch } from "@/lib/confirm-sources-with-search";
import { buildLegalAnalysisPrompt } from "@/lib/legal-prompt";
import type { LegalEmbeddingSearchResult } from "@/lib/search-legal-embedding-records";
import type {
  AnalysisRequest,
  LegalAnalysisResult,
  LegalSearchResult,
  PrimaryLegalAct,
} from "@/lib/types";

/**
 * RED: подключение RAG к /api/analyze.
 *
 * Точка входа выбрана минимальная: retrieval-контекст должен попадать в
 * промпт, который route уже строит перед вызовом модели
 * (callOpenAIResponses(buildLegalAnalysisPrompt(...))). Раз контекст обязан
 * находиться в этом промпте, retrieval неизбежно выполняется до анализа —
 * отдельный orchestrator и параллельный pipeline не нужны.
 *
 * Экспортированный сегодня POST не вызывается: он жёстко импортирует
 * runLegalSourceSearch и callOpenAIResponses, то есть любой его вызов ушёл бы
 * в сеть. Часть контракта поэтому проверяется на уровне production-функций,
 * которые route уже использует, а сама оркестрация — через будущую фабрику
 * обработчика с инъекцией зависимостей (см. блок POST-уровня ниже).
 *
 * Главный инвариант ZanKomek AI: RAG — только слой контекста. Он не имеет
 * права выставлять source_confirmed, search_confirmed, content_checked,
 * verification_status или создавать подтверждённый source_article.
 * Подтверждение остаётся за существующим verification pipeline.
 */

const REQUEST: AnalysisRequest = {
  legalArea: "Персональные данные",
  userType: "too",
  description:
    "Мы собираем имя и телефон через форму заявки на сайте и храним их в CRM.",
  consent: true,
};

const PRIMARY_ACT: PrimaryLegalAct = {
  id: "personal-data-law-kz",
  title: "Закон Республики Казахстан «О персональных данных и их защите»",
  found: true,
  official_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
};

/** Результат retrieval в существующем типе: новых типов RAG не вводит. */
const RETRIEVED: LegalEmbeddingSearchResult[] = [
  {
    chunk_id: "personal-data-law-kz:7:0",
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    article_number: "7",
    article_title: "Условия сбора и обработки персональных данных",
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    anchor: "#z17",
    chunk_text:
      "1. Сбор, обработка персональных данных осуществляются с согласия субъекта персональных данных.",
    chunk_index: 0,
    chunk_total: 1,
    retrieval_score: 1,
  },
  {
    chunk_id: "personal-data-law-kz:8:0",
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    article_number: "8",
    article_title: "Порядок дачи согласия субъекта",
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    chunk_text: "1. Субъект персональных данных дает согласие письменно либо иным способом.",
    chunk_index: 0,
    chunk_total: 1,
    retrieval_score: 0.87,
  },
];

/**
 * Будущая сигнатура: четвёртым аргументом промпт-билдер принимает результаты
 * retrieval. Вызов идёт через явно описанный контракт, поэтому тест падает на
 * поведении, а не на типах.
 */
const buildPromptWithRetrieval = buildLegalAnalysisPrompt as unknown as (
  request: AnalysisRequest,
  searchResults: LegalSearchResult[],
  primaryLegalAct: PrimaryLegalAct | undefined,
  retrieved: LegalEmbeddingSearchResult[],
) => string;

function analysisResult(
  overrides?: Partial<LegalAnalysisResult>,
): LegalAnalysisResult {
  return {
    legalAssessment: "Обработка персональных данных требует согласия субъекта.",
    applicableLaws: [
      {
        act_name:
          "Закон Республики Казахстан «О персональных данных и их защите»",
        article: "7",
        explanation: "Сбор данных требует согласия субъекта.",
      },
    ],
    analysis: "Анализ ситуации.",
    riskAnalysis: "Риски при отсутствии согласия.",
    recommendedActions: ["Получить согласие субъекта."],
    requiredDocuments: ["Политика конфиденциальности"],
    sources: [
      {
        title: "Закон о персональных данных",
        act_name:
          "Закон Республики Казахстан «О персональных данных и их защите»",
        article: "7",
        url: "https://adilet.zan.kz/rus/docs/Z1300000094",
        source_domain: "adilet.zan.kz",
        verification_status: "unverified",
        search_confirmed: false,
      },
    ],
    confidenceLevel: "средний",
    relevanceDate: "2026-08-23",
    generated_at: "2026-08-23T14:00:00.000Z",
    legal_information_status: "unverified",
    legal_information_notice: "",
    verified_by_search: false,
    search_performed: true,
    ...overrides,
  };
}

/** Официальный источник, подтверждённый существующим pipeline. */
const CONFIRMING_SEARCH_RESULT: LegalSearchResult = {
  title: "Закон Республики Казахстан «О персональных данных и их защите»",
  url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  content: "Статья 7. Условия сбора и обработки персональных данных.",
  source_domain: "adilet.zan.kz",
  search_confirmed: true,
  relevance_score: 0.9,
  relevance_status: "direct",
  matched_act_name:
    "Закон Республики Казахстан «О персональных данных и их защите»",
  content_checked: true,
  source_type: "legal_act",
  core_act_id: "personal-data-law-kz",
};

test("retrieved context reaches the model prompt built before the analysis call", () => {
  const prompt = buildPromptWithRetrieval(REQUEST, [], PRIMARY_ACT, RETRIEVED);

  for (const record of RETRIEVED) {
    assert.ok(
      prompt.includes(record.act_name),
      `prompt is missing act_name of ${record.chunk_id}`,
    );
    assert.ok(
      prompt.includes(record.article_number),
      `prompt is missing article_number of ${record.chunk_id}`,
    );
    assert.ok(
      prompt.includes(record.chunk_text),
      `prompt is missing chunk_text of ${record.chunk_id}`,
    );
  }
});

test("the retrieval block carries no embedding vectors into the prompt", () => {
  const prompt = buildPromptWithRetrieval(REQUEST, [], PRIMARY_ACT, RETRIEVED);

  // Контекст обязан присутствовать — иначе проверка на отсутствие векторов
  // прошла бы бессодержательно.
  assert.ok(prompt.includes(RETRIEVED[0].chunk_text));
  assert.doesNotMatch(prompt, /embedding/i);
  assert.doesNotMatch(prompt, /\[-?0\.\d+,\s*-?0\.\d+/);
});

test("the prompt is unchanged when retrieval produced nothing", () => {
  const withoutRetrieval = buildLegalAnalysisPrompt(REQUEST, [], PRIMARY_ACT);
  const withEmptyRetrieval = buildPromptWithRetrieval(
    REQUEST,
    [],
    PRIMARY_ACT,
    [],
  );

  // Контракт fallback: если retrieval недоступен или ничего не нашёл, анализ
  // продолжается ровно как сегодня.
  assert.equal(withEmptyRetrieval, withoutRetrieval);
});

test("a retrieval_score of 1 cannot confirm a source", () => {
  const fromRag = analysisResult({
    applicableLaws: [
      {
        act_name:
          "Закон Республики Казахстан «О персональных данных и их защите»",
        article: "7",
        // Так выглядела бы попытка подтвердить норму по одному лишь retrieval.
        source_confirmed: true,
        verification_status: "official",
        source_article: {
          number: "7",
          title: "Условия сбора и обработки персональных данных",
          text: RETRIEVED[0].chunk_text,
        },
      },
    ],
  });

  // Официальный поиск ничего не подтвердил.
  const enriched = enrichAnalysisWithSearch(fromRag, [], true, PRIMARY_ACT);
  const law = enriched.applicableLaws[0];

  // source_confirmed — авторитетный серверный флаг подтверждения нормы.
  assert.equal(law.source_confirmed, false);
  assert.equal(enriched.verified_by_search, false);
  assert.notEqual(enriched.legal_information_status, "official_sources_present");

  for (const source of enriched.sources) {
    assert.equal(source.search_confirmed, false);
    assert.notEqual(source.content_checked, true);
    // verification_status источника означает лишь официальность домена,
    // поэтому подтверждение видно по обнулённому url и search_confirmed.
    assert.equal(source.url, null);
  }
});

test("a retrieved article_number cannot create a confirmed source_article", () => {
  const fromRag = analysisResult({
    applicableLaws: [
      {
        act_name:
          "Закон Республики Казахстан «О персональных данных и их защите»",
        article: "7",
        source_article: {
          number: RETRIEVED[0].article_number,
          title: RETRIEVED[0].article_title ?? "",
          text: RETRIEVED[0].chunk_text,
        },
      },
    ],
  });

  const enriched = enrichAnalysisWithSearch(fromRag, [], true, PRIMARY_ACT);
  const law = enriched.applicableLaws[0];

  assert.equal(law.source_confirmed, false);
  assert.equal(
    "source_article" in law,
    false,
    "an unconfirmed law must not keep a source_article",
  );
});

test("existing official verification stays authoritative for the positive path", () => {
  const enriched = enrichAnalysisWithSearch(
    analysisResult(),
    [CONFIRMING_SEARCH_RESULT],
    true,
    PRIMARY_ACT,
  );
  const law = enriched.applicableLaws[0];

  assert.equal(law.source_confirmed, true);
  assert.equal(law.source_url, CONFIRMING_SEARCH_RESULT.url);
  assert.equal(law.source_relevance_status, "direct");
  assert.equal(enriched.verified_by_search, true);
});

test("no embedding vectors leak into the analysis payload", () => {
  const enriched = enrichAnalysisWithSearch(
    analysisResult(),
    [CONFIRMING_SEARCH_RESULT],
    true,
    PRIMARY_ACT,
  );
  const serialized = JSON.stringify({ result: enriched });

  assert.doesNotMatch(serialized, /"embedding"/);
  assert.doesNotMatch(serialized, /"embedding_model"/);
  assert.doesNotMatch(serialized, /"embedding_dimensions"/);
});

/**
 * POST-уровень.
 *
 * Проверок промпт-билдера недостаточно: его можно починить, а route так и не
 * станет вызывать retrieval. Поэтому здесь фиксируется сам порядок работы
 * обработчика.
 *
 * Сегодня POST жёстко импортирует runLegalSourceSearch и callOpenAIResponses,
 * поэтому его вызов ушёл бы в Tavily и OpenAI. Значит, нужен минимальный шов:
 * фабрика обработчика с зависимостями по умолчанию, равными сегодняшним
 * функциям. Тест требует именно этот шов и ничего сверх него.
 */

interface AnalyzeSearchOutcome {
  results: LegalSearchResult[];
  performed: boolean;
  primary_legal_act?: PrimaryLegalAct;
}

interface AnalyzeHandlerDependencies {
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

type CreateAnalyzeHandler = (
  dependencies: AnalyzeHandlerDependencies,
) => (request: Request) => Promise<Response>;

async function loadAnalyzeHandlerFactory(): Promise<CreateAnalyzeHandler> {
  const routeModule = (await import("./route")) as unknown as Record<
    string,
    unknown
  >;
  const factory = routeModule.createAnalyzeHandler;

  if (typeof factory !== "function") {
    throw new Error(
      "app/api/analyze/route.ts does not export createAnalyzeHandler: POST has no injectable retrieval seam yet",
    );
  }

  return factory as CreateAnalyzeHandler;
}

/** Валидный ответ модели: route обязан прогнать его через parseAnalysisResult. */
const MODEL_JSON = JSON.stringify({
  legalAssessment: "Обработка персональных данных требует согласия субъекта.",
  applicableLaws: [
    {
      act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
      article: "7",
      explanation: "Сбор данных требует согласия субъекта.",
    },
  ],
  analysis: "Анализ ситуации по обработке персональных данных.",
  riskAnalysis: "Риски при отсутствии согласия субъекта.",
  recommendedActions: ["Получить согласие субъекта."],
  requiredDocuments: ["Политика конфиденциальности"],
  sources: [
    {
      title: "Закон о персональных данных",
      act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
      article: "7",
      url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    },
  ],
  confidenceLevel: "средний",
  relevanceDate: "2026-08-23",
});

function analyzeRequest(): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      legalArea: REQUEST.legalArea,
      userType: REQUEST.userType,
      description: REQUEST.description,
      consent: true,
    }),
  });
}

interface HandlerProbe {
  dependencies: AnalyzeHandlerDependencies;
  calls: string[];
  prompts: string[];
  retrievalInputs: unknown[];
}

function createHandlerProbe(options?: {
  retrieval?: () => Promise<LegalEmbeddingSearchResult[]>;
}): HandlerProbe {
  const calls: string[] = [];
  const prompts: string[] = [];
  const retrievalInputs: unknown[] = [];

  return {
    calls,
    prompts,
    retrievalInputs,
    dependencies: {
      retrieveLegalContext: async (input) => {
        calls.push("retrieval");
        retrievalInputs.push(input);

        return options?.retrieval ? options.retrieval() : RETRIEVED;
      },
      callAnalysis: async (prompt) => {
        calls.push("analysis");
        prompts.push(prompt);

        return MODEL_JSON;
      },
      // performed: false держит маршрут в offline-ветке: повторный поиск по
      // актам модели не запускается, сеть не нужна.
      searchLegalSources: async () => {
        calls.push("search");

        return { results: [], performed: false, primary_legal_act: PRIMARY_ACT };
      },
    },
  };
}

test("POST orchestration exposes an injectable retrieval seam", async () => {
  const factory = await loadAnalyzeHandlerFactory();
  const probe = createHandlerProbe();
  const response = await factory(probe.dependencies)(analyzeRequest());

  assert.equal(response.status, 200);
  assert.ok(
    probe.calls.includes("retrieval"),
    "the analyze handler must invoke retrieval",
  );
});

test("the handler runs retrieval before the analysis call and passes it the query text", async () => {
  const factory = await loadAnalyzeHandlerFactory();
  const probe = createHandlerProbe();

  await factory(probe.dependencies)(analyzeRequest());

  const retrievalAt = probe.calls.indexOf("retrieval");
  const analysisAt = probe.calls.indexOf("analysis");

  assert.notEqual(retrievalAt, -1, "retrieval was never called");
  assert.notEqual(analysisAt, -1, "analysis was never called");
  assert.ok(
    retrievalAt < analysisAt,
    `retrieval must finish before analysis, call order was ${probe.calls.join(" -> ")}`,
  );

  assert.equal(probe.retrievalInputs.length, 1);
  assert.ok(
    JSON.stringify(probe.retrievalInputs[0]).includes(REQUEST.description),
    "retrieval must receive the query text of the request",
  );
});

test("the retrieved context reaches the prompt the analysis call receives", async () => {
  const factory = await loadAnalyzeHandlerFactory();
  const probe = createHandlerProbe();
  const response = await factory(probe.dependencies)(analyzeRequest());

  assert.equal(response.status, 200);
  assert.equal(probe.prompts.length, 1);

  for (const record of RETRIEVED) {
    assert.ok(
      probe.prompts[0].includes(record.chunk_text),
      `the analysed prompt is missing chunk_text of ${record.chunk_id}`,
    );
    assert.ok(probe.prompts[0].includes(record.article_number));
  }

  assert.doesNotMatch(JSON.stringify(await response.json()), /"embedding"/);
});

test("a failing retrieval falls back to the existing analyze flow", async () => {
  const factory = await loadAnalyzeHandlerFactory();
  const probe = createHandlerProbe({
    retrieval: async () => {
      throw new Error("embedding artifact is unavailable");
    },
  });

  const response = await factory(probe.dependencies)(analyzeRequest());

  assert.equal(response.status, 200);
  assert.equal(probe.prompts.length, 1, "analysis must still run without context");
  assert.equal(
    probe.prompts[0],
    buildLegalAnalysisPrompt(REQUEST, [], PRIMARY_ACT),
    "a failed retrieval must leave the prompt exactly as it is today",
  );
});

test("a failing retrieval confirms nothing in the response", async () => {
  const factory = await loadAnalyzeHandlerFactory();
  const probe = createHandlerProbe({
    retrieval: async () => {
      throw new Error("embedding artifact is unavailable");
    },
  });

  const response = await factory(probe.dependencies)(analyzeRequest());
  const body = (await response.json()) as { result: LegalAnalysisResult };

  assert.equal(response.status, 200);
  assert.equal(body.result.verified_by_search, false);
  assert.equal(body.result.search_performed, false);
  assert.notEqual(body.result.legal_information_status, "official_sources_present");

  for (const law of body.result.applicableLaws) {
    assert.notEqual(law.source_confirmed, true);
    assert.equal("source_article" in law, false);
  }

  for (const source of body.result.sources) {
    assert.equal(source.search_confirmed, false);
    assert.notEqual(source.content_checked, true);
  }
});
