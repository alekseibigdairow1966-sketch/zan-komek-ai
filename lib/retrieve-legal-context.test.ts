import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { buildLegalEmbeddingArtifact } from "./build-legal-embedding-artifact";
import { countLegalEmbeddingTokens } from "./count-legal-embedding-tokens";
import type { LegalChunkEmbedding } from "./embed-legal-act-chunks";
import type { OpenAiEmbeddingsClient } from "./openai-legal-chunk-embedder";
import { readLegalEmbeddingArtifact } from "./read-legal-embedding-artifact";
import type { LegalEmbeddingSearchResult } from "./search-legal-embedding-records";
import { serializeLegalEmbeddingArtifact } from "./serialize-legal-embedding-artifact";

/**
 * RED: реальный runtime retrieval для /api/analyze.
 *
 * createAnalyzeHandler уже принимает retrieveLegalContext, но production
 * default пока async () => []. Не хватает самой зависимости: description →
 * query embedding → реальный artifact → searchLegalEmbeddingRecords →
 * ограниченный по бюджету контекст.
 *
 * Ни сети, ни ключей: OpenAI-клиент мокается, artifact — маленькая фикстура,
 * собранная production-сериализатором. Настоящий 61 MB artifact здесь не
 * используется.
 *
 * Инвариант прежний: retrieval возвращает только semantic-контекст и не
 * трогает source_confirmed / search_confirmed / content_checked /
 * verification_status.
 */

/** Живой singleton node:fs/promises — тот же объект, который видит production
 * ридер. import * as даёт копию транспайлера и для подмены не годится. */
const nodeRequire = createRequire(join(process.cwd(), "lib", "x.cjs"));
const fsPromises = nodeRequire("node:fs/promises") as {
  readFile: (...args: unknown[]) => unknown;
};

const MODULE: string = "./retrieve-legal-context";

const EXPECTED_MODEL = "text-embedding-3-small";
const EXPECTED_DIMENSIONS = 1536;

/** Бюджет промпта: значения обязаны принадлежать production-модулю. */
const EXPECTED_TOP_K = 5;
const EXPECTED_MAX_CHUNK_TOKENS = 2000;
const EXPECTED_MAX_CONTEXT_TOKENS = 8000;

const ARTIFACT_PATH_ENV = "LEGAL_EMBEDDING_ARTIFACT_PATH";

const DESCRIPTION =
  "Мы собираем имя и телефон через форму заявки на сайте и храним их в CRM без отдельного согласия.";

interface RetrieverInput {
  legalArea: string;
  userType: string;
  description: string;
}

interface RetrieverDependencies {
  client: OpenAiEmbeddingsClient;
  artifactPath?: string;
}

interface RetrieveLegalContextModule {
  createLegalContextRetriever: (
    dependencies: RetrieverDependencies,
  ) => (input: RetrieverInput) => Promise<LegalEmbeddingSearchResult[]>;
  retrieveLegalContext: (
    input: RetrieverInput,
  ) => Promise<LegalEmbeddingSearchResult[]>;
  LEGAL_RETRIEVAL_TOP_K: number;
  LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS: number;
  LEGAL_RETRIEVAL_MAX_CONTEXT_TOKENS: number;
  LEGAL_EMBEDDING_ARTIFACT_PATH_ENV: string;
}

async function loadRetrieverModule(): Promise<RetrieveLegalContextModule> {
  let loaded: Record<string, unknown>;

  try {
    loaded = (await import(MODULE)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `runtime legal context retriever ${MODULE} does not exist yet: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (typeof loaded.createLegalContextRetriever !== "function") {
    throw new Error(`${MODULE} does not export createLegalContextRetriever`);
  }

  return loaded as unknown as RetrieveLegalContextModule;
}

function vectorOf(seed: number): number[] {
  const vector = new Array<number>(EXPECTED_DIMENSIONS).fill(0);
  vector[0] = 1;
  vector[seed % (EXPECTED_DIMENSIONS - 1) + 1] = 1;
  return vector;
}

/** ~2500 токенов cl100k на статью: и per-chunk, и суммарный лимит реально бьют. */
function articleText(index: number): string {
  const sentence = `Пункт ${index}. Сбор и обработка персональных данных субъекта осуществляются оператором с согласия субъекта персональных данных и в соответствии с законодательством Республики Казахстан. `;

  return sentence.repeat(70).trim();
}

function record(index: number): LegalChunkEmbedding {
  return {
    chunk_id: `personal-data-law-kz:${index}:0`,
    act_id: "personal-data-law-kz",
    act_name: "Закон Республики Казахстан «О персональных данных и их защите»",
    article_number: String(index),
    article_title: `Статья ${index}`,
    source_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
    anchor: `#z${index}`,
    chunk_text: articleText(index),
    chunk_index: 0,
    chunk_total: 1,
    embedding_model: EXPECTED_MODEL,
    embedding_dimensions: EXPECTED_DIMENSIONS,
    embedding: vectorOf(index),
  };
}

const RECORDS = Array.from({ length: 8 }, (_, index) => record(index + 1));

async function withArtifact(
  run: (artifactPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zankomek-retrieval-red-"));
  const artifactPath = join(dir, "legal-embeddings.json");
  const artifact = buildLegalEmbeddingArtifact({
    records: RECORDS,
    artifactVersion: "1",
    corpusVersion: "2026-08-23",
    createdAt: "2026-08-23T15:00:00.000Z",
    chunkStrategy: "article",
  });

  await writeFile(
    artifactPath,
    serializeLegalEmbeddingArtifact(artifact),
    "utf8",
  );

  try {
    await run(artifactPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface EmbeddingsCall {
  model: string;
  input: string[];
  dimensions?: number;
}

function createMockClient(queryVector = vectorOf(3)): {
  client: OpenAiEmbeddingsClient;
  calls: EmbeddingsCall[];
} {
  const calls: EmbeddingsCall[] = [];

  return {
    calls,
    client: {
      embeddings: {
        async create(params) {
          calls.push({
            model: params.model,
            input: [...params.input],
            dimensions: params.dimensions,
          });

          return {
            data: params.input.map((_, index) => ({
              index,
              embedding: queryVector,
            })),
          };
        },
      },
    },
  };
}

function totalTokens(results: LegalEmbeddingSearchResult[]): number {
  return results.reduce(
    (sum, result) => sum + countLegalEmbeddingTokens(result.chunk_text),
    0,
  );
}

test("the retriever uses the description as the semantic query", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client, calls } = createMockClient();

    await module.createLegalContextRetriever({ client, artifactPath })({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });

    assert.equal(calls.length, 1, "exactly one query embedding request");
    assert.deepEqual(calls[0].input, [DESCRIPTION]);
  });
});

test("the query embedding requests the production model and dimensions", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client, calls } = createMockClient();

    await module.createLegalContextRetriever({ client, artifactPath })({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });

    assert.equal(calls[0].model, EXPECTED_MODEL);
    assert.equal(calls[0].dimensions, EXPECTED_DIMENSIONS);
  });
});

test("the artifact path comes from configuration, never from a hardcoded TEMP path", async () => {
  const module = await loadRetrieverModule();

  assert.equal(module.LEGAL_EMBEDDING_ARTIFACT_PATH_ENV, ARTIFACT_PATH_ENV);

  await withArtifact(async (artifactPath) => {
    const previous = process.env[ARTIFACT_PATH_ENV];
    const { client } = createMockClient();

    try {
      process.env[ARTIFACT_PATH_ENV] = artifactPath;

      const fromEnv = await module.createLegalContextRetriever({ client })({
        legalArea: "Персональные данные",
        userType: "too",
        description: DESCRIPTION,
      });

      assert.ok(fromEnv.length > 0, "configured artifact must be used");
    } finally {
      if (previous === undefined) {
        delete process.env[ARTIFACT_PATH_ENV];
      } else {
        process.env[ARTIFACT_PATH_ENV] = previous;
      }
    }
  });

  // Без конфигурации retrieval не должен молча читать какой-то другой artifact
  // и не должен тратить запрос к OpenAI.
  const previous = process.env[ARTIFACT_PATH_ENV];
  const { client, calls } = createMockClient();

  try {
    delete process.env[ARTIFACT_PATH_ENV];

    let results: LegalEmbeddingSearchResult[] | undefined;

    try {
      results = await module.createLegalContextRetriever({ client })({
        legalArea: "Персональные данные",
        userType: "too",
        description: DESCRIPTION,
      });
    } catch {
      results = undefined;
    }

    assert.deepEqual(results ?? [], [], "no context without configuration");
    assert.equal(calls.length, 0, "no embedding request without configuration");
  } finally {
    if (previous !== undefined) {
      process.env[ARTIFACT_PATH_ENV] = previous;
    }
  }
});

test("the retriever returns at most topK results, ranked by semantic score", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client } = createMockClient();

    assert.equal(module.LEGAL_RETRIEVAL_TOP_K, EXPECTED_TOP_K);

    const results = await module.createLegalContextRetriever({
      client,
      artifactPath,
    })({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });

    assert.ok(results.length > 0);
    assert.ok(
      results.length <= EXPECTED_TOP_K,
      `expected at most ${EXPECTED_TOP_K} results, received ${results.length}`,
    );

    for (let index = 1; index < results.length; index += 1) {
      assert.ok(
        results[index - 1].retrieval_score >= results[index].retrieval_score,
        "results must be ranked by score descending",
      );
    }
  });
});

test("no single chunk exceeds the per-chunk prompt token budget", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client } = createMockClient();

    assert.equal(module.LEGAL_RETRIEVAL_MAX_CHUNK_TOKENS, EXPECTED_MAX_CHUNK_TOKENS);

    const results = await module.createLegalContextRetriever({
      client,
      artifactPath,
    })({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });

    for (const result of results) {
      const tokens = countLegalEmbeddingTokens(result.chunk_text);

      assert.ok(
        tokens <= EXPECTED_MAX_CHUNK_TOKENS,
        `${result.chunk_id} carries ${tokens} tokens, limit is ${EXPECTED_MAX_CHUNK_TOKENS}`,
      );
      assert.ok(result.chunk_text.trim().length > 0);
    }
  });
});

test("the whole retrieval context stays inside the total token budget", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client } = createMockClient();

    assert.equal(
      module.LEGAL_RETRIEVAL_MAX_CONTEXT_TOKENS,
      EXPECTED_MAX_CONTEXT_TOKENS,
    );

    const results = await module.createLegalContextRetriever({
      client,
      artifactPath,
    })({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });

    const tokens = totalTokens(results);

    assert.ok(
      tokens <= EXPECTED_MAX_CONTEXT_TOKENS,
      `retrieval context carries ${tokens} tokens, limit is ${EXPECTED_MAX_CONTEXT_TOKENS}`,
    );
  });
});

test("bounding the prompt context leaves the artifact records untouched", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client } = createMockClient();
    const before = await readFile(artifactPath, "utf8");

    const results = await module.createLegalContextRetriever({
      client,
      artifactPath,
    })({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });

    assert.equal(await readFile(artifactPath, "utf8"), before);

    const artifact = await readLegalEmbeddingArtifact({ inputPath: artifactPath });

    for (const stored of artifact.records) {
      const original = RECORDS.find(
        (candidate) => candidate.chunk_id === stored.chunk_id,
      );

      assert.ok(original);
      assert.equal(stored.chunk_text, original.chunk_text);
    }

    // Урезание относится к контексту промпта, а не к самим записям корпуса.
    const truncated = results.find(
      (result) =>
        result.chunk_text !==
        RECORDS.find((candidate) => candidate.chunk_id === result.chunk_id)
          ?.chunk_text,
    );

    assert.ok(truncated, "the oversized fixture chunks must be bounded");
  });
});

test("a missing artifact surfaces as a retrieval failure, never as context", async () => {
  const module = await loadRetrieverModule();
  const { client } = createMockClient();
  const retrieve = module.createLegalContextRetriever({
    client,
    artifactPath: join(tmpdir(), "zankomek-missing-artifact", "nope.json"),
  });

  let results: LegalEmbeddingSearchResult[] | undefined;

  try {
    results = await retrieve({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });
  } catch {
    results = undefined;
  }

  // Маршрут уже перехватывает ошибку retrieval и продолжает анализ без
  // контекста; здесь важно лишь, что контекст не выдумывается.
  assert.deepEqual(results ?? [], []);
});

test("retrieved context carries no verification fields and no vectors", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client } = createMockClient();

    const results = await module.createLegalContextRetriever({
      client,
      artifactPath,
    })({
      legalArea: "Персональные данные",
      userType: "too",
      description: DESCRIPTION,
    });

    assert.ok(results.length > 0);

    for (const result of results) {
      const asRecord = result as unknown as Record<string, unknown>;

      for (const field of [
        "source_confirmed",
        "search_confirmed",
        "content_checked",
        "verification_status",
        "embedding",
        "embedding_model",
        "embedding_dimensions",
      ]) {
        assert.equal(field in asRecord, false, `result must not carry ${field}`);
      }

      assert.equal(typeof result.retrieval_score, "number");
    }
  });
});

/**
 * RED: hybrid reranking внутри runtime retrieval.
 *
 * Чистый reranker уже есть и покрыт тестами, но runtime до него не доходит:
 * createLegalContextRetriever передаёт LEGAL_RETRIEVAL_TOP_K прямо в
 * semantic retrieval, поэтому кандидат ниже semantic Top-5 отсекается раньше,
 * чем reranking мог бы его увидеть.
 *
 * Здесь фиксируется требуемое внешнее поведение, а не будущая реализация:
 * размер candidate pool не утверждается и будущая константа не импортируется.
 * Требование одно — кандидат ниже semantic Top-5 должен иметь возможность
 * попасть в итоговый Top-5, и при этом количество обычных результатов не
 * растёт: candidate_pool_size ≠ prompt topK.
 *
 * Все записи принадлежат одному акту, поэтому predicted-act boost одинаков для
 * всех и не может объяснить продвижение статьи 15. Единственный отличающий
 * сигнал — совпадение по заголовку.
 *
 * Инвариант прежний: retrieval остаётся слоем контекста и не трогает
 * source_confirmed / search_confirmed / content_checked / verification_status.
 */

const RERANK_ACT_ID = "consumer-protection-law-kz";
const RERANK_ACT_NAME =
  "Закон Республики Казахстан «О защите прав потребителей»";
const RERANK_SOURCE_URL = "https://adilet.zan.kz/rus/docs/Z100000274_";

/** Кейс consumer_defective_kettle_01 из benchmark-отчёта. */
const RERANK_DESCRIPTION =
  "Я купил электрический чайник, он сломался через три дня. Какие права у меня есть?";

const RERANK_TARGET_ARTICLE_NUMBER = "15";
const RERANK_TARGET_SEMANTIC_RANK = 6;

/**
 * Вектор запроса — первая ось, вектор записи — единичный вектор под углом с
 * косинусом similarity. Так косинус задаётся точно, а не подбирается, и
 * production сам его считает: retrieval_score в тесте не хардкодится.
 */
function unitVectorWithCosine(cosine: number): number[] {
  const vector = new Array<number>(EXPECTED_DIMENSIONS).fill(0);
  vector[0] = cosine;
  vector[1] = Math.sqrt(1 - cosine * cosine);
  return vector;
}

const RERANK_QUERY_VECTOR = unitVectorWithCosine(1);

/** Короткие тексты: бюджет промпта здесь не должен ничего обрезать. */
function rerankRecord(input: {
  articleNumber: string;
  articleTitle: string;
  chunkText: string;
  cosine: number;
}): LegalChunkEmbedding {
  return {
    chunk_id: `${RERANK_ACT_ID}:${input.articleNumber}:0`,
    act_id: RERANK_ACT_ID,
    act_name: RERANK_ACT_NAME,
    article_number: input.articleNumber,
    article_title: input.articleTitle,
    source_url: RERANK_SOURCE_URL,
    anchor: `#z${input.articleNumber}`,
    chunk_text: input.chunkText,
    chunk_index: 0,
    chunk_total: 1,
    embedding_model: EXPECTED_MODEL,
    embedding_dimensions: EXPECTED_DIMENSIONS,
    embedding: unitVectorWithCosine(input.cosine),
  };
}

/**
 * Шесть записей одного акта. Заголовки кандидатов выше не пересекаются с
 * запросом ни словоформой, ни основой; у статьи 15 в заголовке есть «Права»
 * против «Какие права у меня есть» в запросе — единственный сигнал в фикстуре.
 *
 * Статьи 1 в наборе нет, и ни один текст не содержит «технически сложн»,
 * поэтому существующее definition-expansion правило не срабатывает и итог
 * обязан быть обычным Top-5, а не Top-5 плюс определение.
 */
const RERANK_RECORDS: LegalChunkEmbedding[] = [
  rerankRecord({
    articleNumber: "30",
    articleTitle: "Обязанности продавца при обнаружении недостатков товара",
    chunkText:
      "Продавец обязан принять товар ненадлежащего качества у потребителя и при необходимости провести проверку качества товара.",
    cosine: 0.9,
  }),
  rerankRecord({
    articleNumber: "26",
    articleTitle: "Сроки предъявления требований по недостаткам товара",
    chunkText:
      "Требования, связанные с недостатками товара, предъявляются в течение гарантийного срока или срока годности.",
    cosine: 0.88,
  }),
  rerankRecord({
    articleNumber: "24",
    articleTitle: "Замена товара ненадлежащего качества",
    chunkText:
      "Замена товара ненадлежащего качества производится в течение установленного законодательством периода.",
    cosine: 0.86,
  }),
  rerankRecord({
    articleNumber: "27",
    articleTitle: "Гарантийный срок и срок службы",
    chunkText:
      "Изготовитель устанавливает гарантийный срок и срок службы на изделие в порядке, определённом законодательством.",
    cosine: 0.84,
  }),
  rerankRecord({
    articleNumber: "29",
    articleTitle: "Возмещение убытков, причиненных недостатками товара",
    chunkText:
      "Убытки, причиненные недостатками товара, подлежат возмещению в полном объёме сверх удовлетворения требований потребителя.",
    cosine: 0.82,
  }),
  rerankRecord({
    articleNumber: RERANK_TARGET_ARTICLE_NUMBER,
    articleTitle:
      "Права потребителя при продаже ему товара ненадлежащего качества",
    chunkText:
      "Потребитель вправе по своему выбору потребовать замены изделия, соразмерного уменьшения покупной цены, безвозмездного устранения недостатков либо возврата уплаченной суммы.",
    cosine: 0.81,
  }),
];

/**
 * Тот же production-сериализатор и тот же временный каталог, что и в
 * withArtifact выше; отличается только набор записей, поэтому существующий
 * helper и его фикстура остаются нетронутыми.
 */
async function withRerankArtifact(
  run: (artifactPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zankomek-runtime-rerank-red-"));
  const artifactPath = join(dir, "legal-embeddings.json");
  const artifact = buildLegalEmbeddingArtifact({
    records: RERANK_RECORDS,
    artifactVersion: "1",
    corpusVersion: "2026-08-24",
    createdAt: "2026-08-24T15:00:00.000Z",
    chunkStrategy: "article",
  });

  await writeFile(
    artifactPath,
    serializeLegalEmbeddingArtifact(artifact),
    "utf8",
  );

  try {
    await run(artifactPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runtime retrieval reranks a candidate below semantic Top-5 before applying the final Top-K", async () => {
  await withRerankArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client } = createMockClient(RERANK_QUERY_VECTOR);

    assert.equal(module.LEGAL_RETRIEVAL_TOP_K, EXPECTED_TOP_K);

    // Предпосылка проверяется настоящим поисковым слоем, а не арифметикой
    // теста: артефакт читается production-ридером, а порядок задаёт
    // production-поиск.
    const { searchLegalEmbeddingRecords } = await import(
      "./search-legal-embedding-records"
    );
    const artifact = await readLegalEmbeddingArtifact({
      inputPath: artifactPath,
    });

    const semanticOrder = searchLegalEmbeddingRecords({
      queryEmbedding: RERANK_QUERY_VECTOR,
      records: artifact.records,
      topK: artifact.records.length,
    });

    assert.equal(
      semanticOrder.length,
      RERANK_RECORDS.length,
      "the whole synthetic pool must be scored",
    );

    const targetSemanticRank =
      semanticOrder.findIndex(
        (result) => result.article_number === RERANK_TARGET_ARTICLE_NUMBER,
      ) + 1;

    assert.equal(
      targetSemanticRank,
      RERANK_TARGET_SEMANTIC_RANK,
      `article ${RERANK_TARGET_ARTICLE_NUMBER} must sit at semantic rank ${RERANK_TARGET_SEMANTIC_RANK}, found ${targetSemanticRank}`,
    );

    for (let index = 1; index < semanticOrder.length; index += 1) {
      assert.ok(
        semanticOrder[index - 1].retrieval_score >
          semanticOrder[index].retrieval_score,
        "semantic order must be unambiguous: similarity strictly decreasing",
      );
    }

    const semanticTopK = semanticOrder.slice(0, EXPECTED_TOP_K);

    assert.equal(
      semanticTopK.some(
        (result) => result.article_number === RERANK_TARGET_ARTICLE_NUMBER,
      ),
      false,
      `semantic Top-${EXPECTED_TOP_K} must not contain article ${RERANK_TARGET_ARTICLE_NUMBER}: ${semanticTopK
        .map((result) => result.article_number)
        .join(", ")}`,
    );

    // Основное требование — через публичный runtime entry, а не через reranker.
    const results = await module.createLegalContextRetriever({
      client,
      artifactPath,
    })({
      legalArea: "Защита прав потребителей",
      userType: "fl",
      description: RERANK_DESCRIPTION,
    });

    assert.ok(
      results.length <= module.LEGAL_RETRIEVAL_TOP_K,
      `a wider candidate pool must not widen the prompt: expected at most ${module.LEGAL_RETRIEVAL_TOP_K} results, received ${results.length}`,
    );

    assert.equal(
      results.some(
        (result) => result.article_number === RERANK_TARGET_ARTICLE_NUMBER,
      ),
      true,
      `runtime Top-${module.LEGAL_RETRIEVAL_TOP_K} must contain article ${RERANK_TARGET_ARTICLE_NUMBER} after hybrid reranking: ${results
        .map((result) => result.article_number)
        .join(", ")}`,
    );
  });
});

/**
 * RAG-PERF-DIAG-01: production reader читает и парсит артефакт (~61 MB,
 * ~374 ms) на каждый retrieval. Артефакт иммутабелен между деплоями, поэтому
 * в пределах одного экземпляра retriever он должен загружаться один раз.
 * Query embedding, semantic search и reranking остаются per-request.
 *
 * У createLegalContextRetriever нет DI-точки для самого ридера, поэтому чтения
 * считаются на его собственной I/O-границе — node:fs/promises.readFile, —
 * и только для файла артефакта. Production-код ради теста не меняется.
 */
test("reuses the loaded embedding artifact across repeated retrievals", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();
    const { client, calls } = createMockClient();

    let artifactReadCount = 0;
    const originalReadFile = fsPromises.readFile;

    mock.method(
      fsPromises,
      "readFile",
      function (this: unknown, path: unknown, ...rest: unknown[]) {
        if (String(path) === artifactPath) {
          artifactReadCount += 1;
        }

        return (
          originalReadFile as unknown as (
            this: unknown,
            ...args: unknown[]
          ) => unknown
        ).call(this, path, ...rest);
      },
    );

    try {
      const retrieve = module.createLegalContextRetriever({
        client,
        artifactPath,
      });

      const first = await retrieve({
        legalArea: "personal-data",
        userType: "too",
        description: DESCRIPTION,
      });

      const second = await retrieve({
        legalArea: "personal-data",
        userType: "too",
        description:
          "Клиент требует удалить свои персональные данные из нашей базы, какой срок ответа установлен.",
      });

      // Оба вызова обязаны отработать полностью: иначе счётчики совпали бы
      // из-за раннего выхода, а не из-за переиспользования артефакта.
      assert.ok(first.length > 0, "the first retrieval returned no context");
      assert.ok(second.length > 0, "the second retrieval returned no context");

      // Контрольная предпосылка: кэшируется артефакт, а не результат запроса.
      assert.equal(
        calls.length,
        2,
        "each retrieval must still compute its own query embedding",
      );

      assert.equal(
        artifactReadCount,
        1,
        "the embedding artifact must be read from disk only once per retriever",
      );
    } finally {
      mock.restoreAll();
    }
  });
});

/**
 * RAG-PERF-RUNTIME-RED-01: предыдущий тест фиксирует переиспользование внутри
 * ОДНОГО экземпляра retriever. Production-функция retrieveLegalContext создаёт
 * новый экземпляр на каждый вызов, поэтому между реальными запросами артефакт
 * всё ещё читается заново. Здесь фиксируется runtime-контракт: два
 * последовательных production-вызова в одном процессе используют одну загрузку.
 *
 * retrieveLegalContext жёстко вызывает createOpenAIClient(), поэтому клиент не
 * инъецируется. Подмена делается на существующем шве ниже — globalThis.fetch,
 * которым пользуется OpenAI SDK: сети нет, production-код не меняется.
 */
test("reuses one artifact load across repeated production retrievals", async () => {
  await withArtifact(async (artifactPath) => {
    const module = await loadRetrieverModule();

    const previousPath = process.env[ARTIFACT_PATH_ENV];
    const previousKey = process.env.OPENAI_API_KEY;
    const originalFetch = globalThis.fetch;
    const originalReadFile = fsPromises.readFile;

    let artifactReadCount = 0;
    let embeddingCallCount = 0;

    mock.method(
      fsPromises,
      "readFile",
      function (this: unknown, path: unknown, ...rest: unknown[]) {
        if (String(path) === artifactPath) {
          artifactReadCount += 1;
        }

        return (
          originalReadFile as unknown as (
            this: unknown,
            ...args: unknown[]
          ) => unknown
        ).call(this, path, ...rest);
      },
    );

    try {
      process.env[ARTIFACT_PATH_ENV] = artifactPath;
      process.env.OPENAI_API_KEY = "test-key-not-used-over-the-network";

      // Никаких внешних запросов: embeddings отвечает локальная заглушка.
      globalThis.fetch = (async (input: unknown) => {
        embeddingCallCount += 1;

        assert.match(
          String((input as { url?: string })?.url ?? input),
          /\/embeddings$/,
          "only the embeddings endpoint may be called",
        );

        // SDK по умолчанию запрашивает encoding_format: "base64",
        // поэтому вектор кодируется так же, как его вернул бы OpenAI.
        const float32 = Float32Array.from(vectorOf(3));
        const base64 = Buffer.from(
          float32.buffer,
          float32.byteOffset,
          float32.byteLength,
        ).toString("base64");

        return new Response(
          JSON.stringify({
            object: "list",
            model: EXPECTED_MODEL,
            data: [{ object: "embedding", index: 0, embedding: base64 }],
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof globalThis.fetch;

      const first = await module.retrieveLegalContext({
        legalArea: "personal-data",
        userType: "too",
        description: DESCRIPTION,
      });

      const second = await module.retrieveLegalContext({
        legalArea: "personal-data",
        userType: "too",
        description:
          "Клиент требует удалить свои персональные данные из нашей базы, какой срок ответа установлен.",
      });

      assert.ok(first.length > 0, "the first production retrieval returned no context");
      assert.ok(second.length > 0, "the second production retrieval returned no context");

      assert.equal(
        embeddingCallCount,
        2,
        "each production retrieval must still compute its own query embedding",
      );

      assert.equal(
        artifactReadCount,
        1,
        "repeated production retrievals must share a single artifact load",
      );
    } finally {
      globalThis.fetch = originalFetch;
      mock.restoreAll();

      if (previousPath === undefined) {
        delete process.env[ARTIFACT_PATH_ENV];
      } else {
        process.env[ARTIFACT_PATH_ENV] = previousPath;
      }

      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
  });
});
