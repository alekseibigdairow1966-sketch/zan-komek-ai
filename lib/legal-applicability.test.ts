import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildLegalEmbeddingArtifact } from "./build-legal-embedding-artifact";
import { countLegalEmbeddingTokens } from "./count-legal-embedding-tokens";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import { buildLegalAnalysisPrompt } from "./legal-prompt";
import type { OpenAiEmbeddingsClient } from "./openai-legal-chunk-embedder";
import {
  createLegalContextRetriever,
  LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS,
  LEGAL_RETRIEVAL_MAX_CONTEXT_TOKENS,
  LEGAL_RETRIEVAL_TOP_K,
} from "./retrieve-legal-context";
import {
  searchLegalEmbeddingRecords,
  type LegalEmbeddingSearchResult,
} from "./search-legal-embedding-records";
import { serializeLegalEmbeddingArtifact } from "./serialize-legal-embedding-artifact";
import type { AnalysisRequest, PrimaryLegalAct } from "./types";

/**
 * RED: применимость нормы к фактам.
 *
 * Воспроизводимый дефект после включения RAG: для обычного электрического
 * чайника и утюга модель обсуждает специальный режим статьи 30 п. 2-1 Закона
 * «О защите прав потребителей», то есть считает бытовой прибор технически
 * сложным товаром.
 *
 * Официальное определение (ст. 1 подп. 14-1 того же закона) закрыто по
 * составу: «...к которому относятся исключительно транспортные средства,
 * сельскохозяйственная техника, водные и воздушные суда». Его первая половина
 * («непродовольственный товар с технически сложным внутренним устройством...»)
 * описывает и чайник, поэтому без завершающего перечня вывод получается
 * неверным.
 *
 * Диагностика по реальному корпусу (read-only, без сети):
 * - ст. 1 занимает 2340 токенов, определение 14-1 заканчивается на 1577-м,
 *   то есть переживает лимит в 2000 токенов; урезание не является причиной;
 * - ст. 30 занимает 4065 токенов, пункт 2-1 попадает в сохраняемый префикс;
 * - retrieval идёт по всем 2002 записям семи актов без фильтра и с topK = 5,
 *   расширения определениями нет: статья-определение почти наверняка не
 *   попадает в выдачу вместе с оперативной статьёй;
 * - в промпте нет ни одного правила о проверке определений и условий
 *   применимости: все 21 правило посвящены подтверждению источника.
 *
 * Отсюда два уровня защиты, которые здесь и фиксируются.
 *
 * Инварианты не меняются: source_confirmed, search_confirmed, content_checked
 * и source_article остаются за verification pipeline, новый флаг
 * applicability_confirmed не вводится.
 */

const REQUEST: AnalysisRequest = {
  legalArea: "Защита прав потребителей",
  userType: "individual",
  description:
    "Купил электрический утюг, он сломался через месяц, продавец отказывается возвращать деньги.",
  consent: true,
};

const PRIMARY_ACT: PrimaryLegalAct = {
  id: "consumer-protection-law-kz",
  title: "Закон Республики Казахстан «О защите прав потребителей»",
  found: true,
  official_url: "https://adilet.zan.kz/rus/docs/Z100000274_",
};

const ARTICLE_30_TEXT =
  "2-1. В случае обнаружения потребителем существенного недостатка технически сложного товара и предъявления им требования о расторжении договора и возврате уплаченных за товар денег продавец (изготовитель, исполнитель) технически сложного товара и его компонента вправе провести экспертизу товара.";

const DEFINITION_14_1_TEXT =
  "14-1) технически сложный товар – непродовольственный товар с технически сложным внутренним устройством, который включает в себя множество конструктивных и (или) разнородных элементов, образующих одно целое, позволяющее использовать его по назначению, определяемому существом соединения, к которому относятся исключительно транспортные средства, сельскохозяйственная техника, водные и воздушные суда;";

const RETRIEVED_ARTICLE_30: LegalEmbeddingSearchResult = {
  chunk_id: "consumer-protection-law-kz:30:0",
  act_id: "consumer-protection-law-kz",
  act_name: "Закон Республики Казахстан «О защите прав потребителей»",
  article_number: "30",
  article_title:
    "Обязанности продавца (изготовителя) при продаже товара как надлежащего, так и ненадлежащего качества",
  source_url: PRIMARY_ACT.official_url ?? "",
  anchor: "#z30",
  chunk_text: ARTICLE_30_TEXT,
  chunk_index: 0,
  chunk_total: 1,
  retrieval_score: 0.83,
};

const RETRIEVED_DEFINITION: LegalEmbeddingSearchResult = {
  chunk_id: "consumer-protection-law-kz:1:0",
  act_id: "consumer-protection-law-kz",
  act_name: "Закон Республики Казахстан «О защите прав потребителей»",
  article_number: "1",
  article_title: "Основные понятия, используемые в настоящем Законе",
  source_url: PRIMARY_ACT.official_url ?? "",
  anchor: "#z1",
  chunk_text: DEFINITION_14_1_TEXT,
  chunk_index: 0,
  chunk_total: 1,
  retrieval_score: 0.41,
};

/**
 * Смысловые маркеры будущего раздела о применимости. Проверяется наличие
 * правил, а не конкретных предложений: каждая проверка отвечает за отдельное
 * требование контракта.
 */
const APPLICABILITY_SECTION = /ПРИМЕНИМОСТ[ЬИ]/;
const DEFINITIONS_RULE = /определени/i;
const CONDITIONS_RULE = /услови/i;
const EXHAUSTIVE_RULE = /исчерпывающ|закрыт(ый|ого)\s+перечн|только\s+перечисленн/i;
const SEMANTIC_NOT_LEGAL_RULE =
  /(семантическ|смыслов|близост)[^.]*(не\s+означает|не\s+равн|не\s+подтвержда)/i;
const CONFIRMED_NOT_APPLICABLE_RULE =
  /(подтвержд[^.]{0,80}источник|source_confirmed)[^.]*(не\s+означает|не\s+делает)[^.]*примен/i;
const APPLICABLE_WHEN_IN_CATEGORY_RULE =
  /(относится|входит|подпадает)[^.]*категор|категор[^.]*(относится|входит|подпадает)/i;

test("the prompt carries an applicability section even without retrieval", () => {
  const prompt = buildLegalAnalysisPrompt(REQUEST, [], PRIMARY_ACT);

  assert.match(
    prompt,
    APPLICABILITY_SECTION,
    "the prompt must carry an explicit applicability section",
  );
  assert.match(prompt, DEFINITIONS_RULE, "the prompt must require checking definitions");
  assert.match(prompt, CONDITIONS_RULE, "the prompt must require checking conditions");
});

test("the prompt forbids widening an exhaustively defined category by everyday meaning", () => {
  const prompt = buildLegalAnalysisPrompt(
    REQUEST,
    [],
    PRIMARY_ACT,
    [RETRIEVED_ARTICLE_30, RETRIEVED_DEFINITION],
  );

  assert.match(
    prompt,
    EXHAUSTIVE_RULE,
    "the prompt must state that a legally exhaustive category cannot be widened",
  );
  assert.match(
    prompt,
    SEMANTIC_NOT_LEGAL_RULE,
    "the prompt must state that semantic relevance is not legal applicability",
  );
});

test("the prompt separates a confirmed source from applicability to the facts", () => {
  const prompt = buildLegalAnalysisPrompt(
    REQUEST,
    [],
    PRIMARY_ACT,
    [RETRIEVED_ARTICLE_30],
  );

  assert.match(
    prompt,
    CONFIRMED_NOT_APPLICABLE_RULE,
    "the prompt must state that a confirmed source does not make the norm applicable to the facts",
  );
});

test("the applicability rules keep the special provision usable for a real technically complex good", () => {
  const vehicleRequest: AnalysisRequest = {
    ...REQUEST,
    description:
      "Купил автомобиль, обнаружен существенный недостаток, продавец отказывается расторгать договор.",
  };
  const prompt = buildLegalAnalysisPrompt(
    vehicleRequest,
    [],
    PRIMARY_ACT,
    [RETRIEVED_ARTICLE_30, RETRIEVED_DEFINITION],
  );

  // Правило должно быть условным, а не запретом специальной нормы: если товар
  // действительно относится к определённой законом категории, статья 30
  // остаётся применимой.
  assert.match(
    prompt,
    APPLICABLE_WHEN_IN_CATEGORY_RULE,
    "the prompt must keep the special provision applicable when the good is in the defined category",
  );
  assert.doesNotMatch(
    prompt,
    /статья\s*30[^.]{0,40}(никогда|не\s+применяется\s+вообще)/i,
    "the prompt must not ban the special provision outright",
  );
});

interface FixtureArtifact {
  artifactPath: string;
}

function vector(indexes: number[]): number[] {
  const values = new Array<number>(1536).fill(0);

  for (const index of indexes) {
    values[index] = 1;
  }

  return values;
}

function record(input: {
  articleNumber: string;
  title: string;
  text: string;
  embedding: number[];
}): LegalChunkEmbedding {
  return {
    chunk_id: `consumer-protection-law-kz:${input.articleNumber}:0`,
    act_id: "consumer-protection-law-kz",
    act_name: "Закон Республики Казахстан «О защите прав потребителей»",
    article_number: input.articleNumber,
    article_title: input.title,
    source_url: PRIMARY_ACT.official_url ?? "",
    anchor: `#z${input.articleNumber}`,
    chunk_text: input.text,
    chunk_index: 0,
    chunk_total: 1,
    embedding_model: "text-embedding-3-small",
    embedding_dimensions: 1536,
    embedding: input.embedding,
  };
}

/**
 * Корпус, повторяющий реальную расстановку: оперативная статья 30 близка к
 * запросу, статья-определение — нет, поэтому в topK = 5 она не попадает.
 */
const FIXTURE_RECORDS: LegalChunkEmbedding[] = [
  record({
    articleNumber: "30",
    title: "Обязанности продавца при продаже товара ненадлежащего качества",
    text: ARTICLE_30_TEXT,
    embedding: vector([0]),
  }),
  ...["14", "15", "16", "17"].map((articleNumber, index) =>
    record({
      articleNumber,
      title: `Статья ${articleNumber}`,
      text: `Права потребителя при обнаружении недостатков товара, пункт ${index + 1}. Возврат и обмен товара ненадлежащего качества.`,
      embedding: vector([0, 100 + index]),
    }),
  ),
  record({
    articleNumber: "1",
    title: "Основные понятия, используемые в настоящем Законе",
    text: DEFINITION_14_1_TEXT,
    embedding: vector([900]),
  }),
];

async function withFixtureArtifact(
  run: (fixture: FixtureArtifact) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zankomek-applicability-red-"));
  const artifactPath = join(dir, "legal-embeddings.json");

  await writeFile(
    artifactPath,
    serializeLegalEmbeddingArtifact(
      buildLegalEmbeddingArtifact({
        records: FIXTURE_RECORDS,
        artifactVersion: "1",
        corpusVersion: "2026-08-23",
        createdAt: "2026-08-23T15:30:00.000Z",
        chunkStrategy: "article",
      }),
    ),
    "utf8",
  );

  try {
    await run({ artifactPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createMockClient(): OpenAiEmbeddingsClient {
  return {
    embeddings: {
      async create(params) {
        return {
          data: params.input.map((_, index) => ({
            index,
            // Запрос про утюг: близок к статье 30, далёк от статьи-определения.
            embedding: vector([0]),
          })),
        };
      },
    },
  };
}

function retrieveContext(artifactPath: string) {
  return createLegalContextRetriever({
    client: createMockClient(),
    artifactPath,
  })({
    legalArea: REQUEST.legalArea,
    userType: REQUEST.userType,
    description: REQUEST.description,
  });
}

test("plain semantic ranking never brings the defining article into topK", () => {
  // Root cause на уровне поиска: он не изменится и после исправления, поэтому
  // определение обязано приходить отдельным механизмом, а не ранжированием.
  const ranked = searchLegalEmbeddingRecords({
    queryEmbedding: vector([0]),
    records: FIXTURE_RECORDS,
    topK: LEGAL_RETRIEVAL_TOP_K,
  });

  assert.equal(ranked.length, LEGAL_RETRIEVAL_TOP_K);
  assert.ok(
    ranked.some((result) => result.article_number === "30"),
    "the operative article is retrieved by similarity",
  );
  assert.equal(
    ranked.some((result) => result.article_number === "1"),
    false,
    "the definition article is not semantically close to the query",
  );
});

test("retrieval supplies the defining article when a retrieved provision uses a defined category", async () => {
  await withFixtureArtifact(async ({ artifactPath }) => {
    const results = await retrieveContext(artifactPath);
    const definition = results.find(
      (result) =>
        result.act_id === "consumer-protection-law-kz" &&
        result.article_number === "1",
    );

    assert.ok(
      definition,
      "the statutory definition article must accompany the special provision",
    );
    assert.match(
      definition.chunk_text,
      /исключительно транспортные средства/,
      "the exhaustive enumeration must reach the model",
    );
  });
});

test("the definition expansion stays inside the prompt budget", async () => {
  await withFixtureArtifact(async ({ artifactPath }) => {
    const results = await retrieveContext(artifactPath);

    assert.ok(
      results.some((result) => result.article_number === "1"),
      "the definition must be present before the budget is checked",
    );
    assert.ok(
      results.length <= LEGAL_RETRIEVAL_TOP_K + 1,
      `expected at most ${LEGAL_RETRIEVAL_TOP_K + 1} results, received ${results.length}`,
    );

    let total = 0;

    for (const result of results) {
      const tokens = countLegalEmbeddingTokens(result.chunk_text);

      assert.ok(tokens <= LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS);
      total += tokens;
    }

    assert.ok(total <= LEGAL_RETRIEVAL_MAX_CONTEXT_TOKENS);
  });
});

test("the definition expansion adds no verification fields", async () => {
  await withFixtureArtifact(async ({ artifactPath }) => {
    const results = await retrieveContext(artifactPath);

    assert.ok(results.some((result) => result.article_number === "1"));

    for (const result of results) {
      const asRecord = result as unknown as Record<string, unknown>;

      for (const field of [
        "source_confirmed",
        "search_confirmed",
        "content_checked",
        "verification_status",
        "applicability_confirmed",
        "embedding",
      ]) {
        assert.equal(field in asRecord, false, `result must not carry ${field}`);
      }
    }
  });
});
