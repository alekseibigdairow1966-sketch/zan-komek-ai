import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegalEmbeddingSearchResult } from "./search-legal-embedding-records";

/**
 * RED: hybrid reranking поверх семантической выдачи.
 *
 * Диагностика HYBRID-RERANK-DIAG-01 и benchmark
 * data/benchmarks/zankomek_rag_benchmark_20_report.json показывают, что нужная
 * статья почти всегда есть в широком пуле кандидатов, но лежит ниже пятой
 * позиции: primary_article_recall_at_5 = 0.40 при recall_at_50 = 1.00.
 * Кейс consumer_defective_kettle_01: semantic_primary_rank = 7,
 * hybrid_primary_rank = 4, hybrid_primary_at_5 = true.
 *
 * Здесь фиксируется только поведенческая граница будущего чистого reranker-а:
 * кандидат ниже semantic Top-5 обязан иметь возможность попасть в итоговый
 * Top-5 за счёт hybrid ranking signal. Ни alpha, ни act boost, ни конкретное
 * значение hybrid score на этом шаге не фиксируются.
 *
 * Ни сети, ни OpenAI, ни файловой системы, ни artifact-а, ни runtime
 * retrieval: массив кандидатов полностью синтетический.
 *
 * Инвариант ZanKomek AI не меняется: reranking — слой ranking/relevance. Он не
 * выставляет source_confirmed, search_confirmed, content_checked и
 * verification_status; в фикстуре этих полей нет по построению.
 */

const MODULE = "./rerank-legal-candidates";

/** Итоговое окно промпта: LEGAL_RETRIEVAL_TOP_K в retrieve-legal-context.ts. */
const TOP_K = 5;

/** Кейс consumer_defective_kettle_01 из benchmark-отчёта. */
const QUERY_TEXT =
  "Я купил электрический чайник, он сломался через три дня. Какие права у меня есть?";

const PRIMARY_ACT_ID = "consumer-protection-law-kz";
const PRIMARY_ARTICLE_NUMBER = "15";

/** semantic_primary_rank = 7, то есть индекс 6 в порядке убывания score. */
const PRIMARY_SEMANTIC_RANK = 7;

interface RerankLegalCandidatesInput {
  queryText: string;
  candidates: LegalEmbeddingSearchResult[];
}

interface RerankLegalCandidatesModule {
  rerankLegalCandidates: (
    input: RerankLegalCandidatesInput,
  ) => LegalEmbeddingSearchResult[];
}

async function loadRerankerModule(): Promise<RerankLegalCandidatesModule> {
  let loaded: Record<string, unknown>;

  try {
    loaded = (await import(MODULE)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `pure legal candidate reranker ${MODULE} does not exist yet: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (typeof loaded.rerankLegalCandidates !== "function") {
    throw new Error(`${MODULE} does not export rerankLegalCandidates`);
  }

  return loaded as unknown as RerankLegalCandidatesModule;
}

const ACT_NAMES: Record<string, string> = {
  "consumer-protection-law-kz":
    "Закон Республики Казахстан «О защите прав потребителей»",
  "civil-code-special-kz":
    "Гражданский кодекс Республики Казахстан (особенная часть)",
  "civil-code-general-kz":
    "Гражданский кодекс Республики Казахстан (Общая часть)",
};

const SOURCE_URLS: Record<string, string> = {
  "consumer-protection-law-kz": "https://adilet.zan.kz/rus/docs/Z100000274_",
  "civil-code-special-kz": "https://adilet.zan.kz/rus/docs/K990000409_",
  "civil-code-general-kz": "https://adilet.zan.kz/rus/docs/K940001000_",
};

/**
 * Ровно та форма, которую отдаёт searchLegalEmbeddingRecords: метаданные плюс
 * retrieval_score, без вектора и без единого поля подтверждения.
 */
function candidate(input: {
  actId: string;
  articleNumber: string;
  articleTitle: string;
  chunkText: string;
  retrievalScore: number;
}): LegalEmbeddingSearchResult {
  return {
    chunk_id: `${input.actId}:${input.articleNumber}:0`,
    act_id: input.actId,
    act_name: ACT_NAMES[input.actId],
    article_number: input.articleNumber,
    article_title: input.articleTitle,
    source_url: SOURCE_URLS[input.actId],
    chunk_text: input.chunkText,
    chunk_index: 0,
    chunk_total: 1,
    retrieval_score: input.retrievalScore,
  };
}

/**
 * Восемь кандидатов в чистом семантическом порядке: retrieval_score строго
 * убывает, поэтому порядок однозначен и не зависит от правила разрешения
 * равенств. Статья 15 стоит седьмой — как в benchmark-кейсе — и её заголовок,
 * в отличие от заголовков кандидатов выше, лексически перекликается с
 * запросом («права»), то есть сигнал для hybrid ranking в данных есть.
 */
const SEMANTIC_CANDIDATES: LegalEmbeddingSearchResult[] = [
  candidate({
    actId: PRIMARY_ACT_ID,
    articleNumber: "30",
    articleTitle:
      "Обязанности продавца (изготовителя, исполнителя) при обнаружении недостатков товара",
    chunkText:
      "Продавец обязан принять товар ненадлежащего качества у потребителя и в случае необходимости провести проверку качества товара.",
    retrievalScore: 0.6214,
  }),
  candidate({
    actId: PRIMARY_ACT_ID,
    articleNumber: "26",
    articleTitle: "Сроки предъявления требований по недостаткам товара",
    chunkText:
      "Потребитель вправе предъявить требования, связанные с недостатками товара, в течение гарантийного срока или срока годности.",
    retrievalScore: 0.6088,
  }),
  candidate({
    actId: "civil-code-special-kz",
    articleNumber: "428",
    articleTitle: "Последствия передачи товара ненадлежащего качества",
    chunkText:
      "Если недостатки товара не были оговорены продавцом, покупатель вправе потребовать соразмерного уменьшения покупной цены.",
    retrievalScore: 0.5977,
  }),
  candidate({
    actId: "civil-code-special-kz",
    articleNumber: "429",
    articleTitle: "Сроки обнаружения недостатков переданного товара",
    chunkText:
      "Покупатель вправе предъявить требования, связанные с недостатками товара, при их обнаружении в течение гарантийного срока.",
    retrievalScore: 0.5841,
  }),
  candidate({
    actId: PRIMARY_ACT_ID,
    articleNumber: "1",
    articleTitle: "Основные понятия, используемые в настоящем Законе",
    chunkText:
      "В настоящем Законе используются следующие основные понятия: товар, продавец, изготовитель, недостаток товара, существенный недостаток товара.",
    retrievalScore: 0.5703,
  }),
  candidate({
    actId: "civil-code-general-kz",
    articleNumber: "272",
    articleTitle: "Исполнение обязательства надлежащим образом",
    chunkText:
      "Обязательство должно исполняться надлежащим образом в соответствии с условиями обязательства и требованиями законодательства.",
    retrievalScore: 0.5566,
  }),
  candidate({
    actId: PRIMARY_ACT_ID,
    articleNumber: PRIMARY_ARTICLE_NUMBER,
    articleTitle:
      "Права потребителя при продаже ему товара ненадлежащего качества",
    chunkText:
      "Потребитель в случае продажи ему товара ненадлежащего качества вправе по своему выбору потребовать замены товара, соразмерного уменьшения покупной цены, безвозмездного устранения недостатков либо расторжения договора и возврата уплаченной за товар суммы.",
    retrievalScore: 0.5429,
  }),
  candidate({
    actId: "civil-code-special-kz",
    articleNumber: "406",
    articleTitle: "Договор купли-продажи",
    chunkText:
      "По договору купли-продажи одна сторона обязуется передать имущество в собственность другой стороне, а покупатель обязуется принять это имущество и уплатить за него определённую денежную сумму.",
    retrievalScore: 0.5312,
  }),
];

function articleNumbersOf(results: LegalEmbeddingSearchResult[]): string[] {
  return results.map((result) => result.article_number);
}

function containsPrimaryArticle(
  results: LegalEmbeddingSearchResult[],
): boolean {
  return results.some(
    (result) =>
      result.act_id === PRIMARY_ACT_ID &&
      result.article_number === PRIMARY_ARTICLE_NUMBER,
  );
}

// A. Исходная проблема. Проверяется на самой фикстуре, без будущего модуля:
// если этот тест перестанет падать сам по себе, значит фикстура перестала
// воспроизводить дефект и тест B больше ничего не доказывает.
test("plain semantic order keeps the primary article out of the prompt Top-5", () => {
  for (let index = 1; index < SEMANTIC_CANDIDATES.length; index += 1) {
    assert.ok(
      SEMANTIC_CANDIDATES[index - 1].retrieval_score >
        SEMANTIC_CANDIDATES[index].retrieval_score,
      "semantic order must be unambiguous: retrieval_score strictly decreasing",
    );
  }

  const primaryIndex = SEMANTIC_CANDIDATES.findIndex(
    (result) =>
      result.act_id === PRIMARY_ACT_ID &&
      result.article_number === PRIMARY_ARTICLE_NUMBER,
  );

  assert.equal(
    primaryIndex + 1,
    PRIMARY_SEMANTIC_RANK,
    `benchmark case places article ${PRIMARY_ARTICLE_NUMBER} at semantic rank ${PRIMARY_SEMANTIC_RANK}`,
  );

  const semanticTopK = SEMANTIC_CANDIDATES.slice(0, TOP_K);

  assert.equal(
    containsPrimaryArticle(semanticTopK),
    false,
    `semantic Top-${TOP_K} must not contain article ${PRIMARY_ARTICLE_NUMBER}: ${articleNumbersOf(
      semanticTopK,
    ).join(", ")}`,
  );
});

// B. Контракт будущего reranker-а: кандидат ниже semantic Top-5 обязан иметь
// возможность попасть в итоговый Top-5 за счёт hybrid ranking signal.
// Количество chunks, уходящих в промпт, при этом не растёт: срез остаётся Top-5.
test("hybrid reranking lifts the primary article into the prompt Top-5", async () => {
  const { rerankLegalCandidates } = await loadRerankerModule();

  const reranked = rerankLegalCandidates({
    queryText: QUERY_TEXT,
    candidates: SEMANTIC_CANDIDATES,
  });

  const rerankedTopK = reranked.slice(0, TOP_K);

  assert.equal(
    containsPrimaryArticle(rerankedTopK),
    true,
    `reranked Top-${TOP_K} must contain article ${PRIMARY_ARTICLE_NUMBER}: ${articleNumbersOf(
      rerankedTopK,
    ).join(", ")}`,
  );
});

/**
 * RED: русская морфология в title-сигнале.
 *
 * Кейс labour_probation_period_01 из benchmark-отчёта: запрос про срок
 * испытания, ожидаемый акт labour-code-kz, primary article 36
 * («Условие об испытательном сроке в трудовом договоре»),
 * semantic_primary_rank = 47, hybrid_primary_rank = 23. Именно на этом кейсе
 * в Colab было видно, что точное совпадение словоформ даёт ноль, а Russian
 * Snowball stemming — положительный overlap.
 *
 * Совпадений словоформ между запросом и заголовком статьи 36 нет вообще:
 * «срок» / «сроке», «трудового» / «трудовом», «договора» / «договоре» — это
 * разные формы одних и тех же слов, и лексическая нормализация их не сводит.
 *
 * Фикстура ниже — минимальная изоляция этого сигнала, а не воспроизведение
 * полного benchmark-кейса: статья 36 стоит шестой, сразу под окном промпта.
 *
 * Тест не фиксирует ни конкретный stem, ни значение overlap, ни hybrid score,
 * ни библиотеку и ни один API: проверяется только внешнее поведение — формы
 * одного слова обязаны давать полезный ranking-сигнал.
 */

/** Запрос кейса labour_probation_period_01, дословно из benchmark-отчёта. */
const MORPHOLOGY_QUERY_TEXT =
  "Какой максимальный срок испытания при заключении трудового договора может быть установлен по Трудовому кодексу Республики Казахстан?";

const MORPHOLOGY_ACT_ID = "labour-code-kz";
const MORPHOLOGY_ARTICLE_NUMBER = "36";

/** Статья 36 стоит сразу под окном промпта. */
const MORPHOLOGY_SEMANTIC_RANK = 6;

const MORPHOLOGY_ARTICLE_TITLE =
  "Условие об испытательном сроке в трудовом договоре";

/**
 * Весь пул принадлежит одному акту, поэтому predicted-act boost одинаков для
 * всех кандидатов и не может объяснить продвижение статьи 36.
 */
function labourCandidate(input: {
  articleNumber: string;
  articleTitle: string;
  chunkText: string;
  retrievalScore: number;
}): LegalEmbeddingSearchResult {
  return {
    chunk_id: `${MORPHOLOGY_ACT_ID}:${input.articleNumber}:0`,
    act_id: MORPHOLOGY_ACT_ID,
    act_name: "Трудовой кодекс Республики Казахстан",
    article_number: input.articleNumber,
    article_title: input.articleTitle,
    source_url: "https://adilet.zan.kz/rus/docs/K1500000414",
    chunk_text: input.chunkText,
    chunk_index: 0,
    chunk_total: 1,
    retrieval_score: input.retrievalScore,
  };
}

/**
 * Заголовки кандидатов выше подобраны так, чтобы не пересекаться с запросом ни
 * словоформой, ни основой: ни «срок», ни «трудов», ни «договор», ни «кодекс»,
 * ни «заключ», ни «установл» в них не встречаются. Единственный кандидат, у
 * которого с запросом есть общие слова, — статья 36, и общие они только в
 * разных грамматических формах.
 */
const MORPHOLOGY_CANDIDATES: LegalEmbeddingSearchResult[] = [
  labourCandidate({
    articleNumber: "88",
    articleTitle: "Ежегодный оплачиваемый отпуск",
    chunkText:
      "Работникам предоставляется ежегодный оплачиваемый отпуск продолжительностью двадцать четыре календарных дня.",
    retrievalScore: 0.6402,
  }),
  labourCandidate({
    articleNumber: "68",
    articleTitle: "Продолжительность рабочего времени",
    chunkText:
      "Нормальная продолжительность рабочего времени не должна превышать сорока часов в неделю.",
    retrievalScore: 0.6281,
  }),
  labourCandidate({
    articleNumber: "113",
    articleTitle: "Выплата заработной платы",
    chunkText:
      "Заработная плата выплачивается в денежной форме не реже одного раза в месяц.",
    retrievalScore: 0.6157,
  }),
  labourCandidate({
    articleNumber: "38",
    articleTitle: "Перевод работника на другую работу",
    chunkText:
      "Перевод работника на другую работу допускается с его письменного согласия.",
    retrievalScore: 0.6034,
  }),
  labourCandidate({
    articleNumber: "124",
    articleTitle: "Гарантии и компенсационные выплаты",
    chunkText:
      "Работникам гарантируются компенсационные выплаты в случаях, предусмотренных настоящим Кодексом.",
    retrievalScore: 0.5918,
  }),
  labourCandidate({
    articleNumber: MORPHOLOGY_ARTICLE_NUMBER,
    articleTitle: MORPHOLOGY_ARTICLE_TITLE,
    chunkText:
      "Для проверки соответствия квалификации работника поручаемой работе в трудовом договоре может быть предусмотрено условие об испытании.",
    retrievalScore: 0.5602,
  }),
  labourCandidate({
    articleNumber: "182",
    articleTitle: "Охрана здоровья работников",
    chunkText:
      "Работодатель обязан обеспечить безопасные условия деятельности и охрану здоровья работников.",
    retrievalScore: 0.5471,
  }),
  labourCandidate({
    articleNumber: "159",
    articleTitle: "Разрешение индивидуальных споров",
    chunkText:
      "Индивидуальные споры рассматриваются согласительными комиссиями либо судами.",
    retrievalScore: 0.5340,
  }),
];

function containsMorphologyArticle(
  results: LegalEmbeddingSearchResult[],
): boolean {
  return results.some(
    (result) => result.article_number === MORPHOLOGY_ARTICLE_NUMBER,
  );
}

/**
 * Грубое разбиение по не-буквам — рассуждение самого теста о фикстуре, а не
 * утверждение о внутреннем токенизаторе reranker-а.
 */
function surfaceWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

test("Russian word forms give the title signal that exact matching misses", async () => {
  const { rerankLegalCandidates } = await loadRerankerModule();

  for (let index = 1; index < MORPHOLOGY_CANDIDATES.length; index += 1) {
    assert.ok(
      MORPHOLOGY_CANDIDATES[index - 1].retrieval_score >
        MORPHOLOGY_CANDIDATES[index].retrieval_score,
      "semantic order must be unambiguous: retrieval_score strictly decreasing",
    );
  }

  assert.equal(
    new Set(MORPHOLOGY_CANDIDATES.map((result) => result.act_id)).size,
    1,
    "one act only: the predicted-act boost must be identical for every candidate",
  );

  const morphologyIndex = MORPHOLOGY_CANDIDATES.findIndex(
    (result) => result.article_number === MORPHOLOGY_ARTICLE_NUMBER,
  );

  assert.equal(
    morphologyIndex + 1,
    MORPHOLOGY_SEMANTIC_RANK,
    `article ${MORPHOLOGY_ARTICLE_NUMBER} must start below the prompt window, at semantic rank ${MORPHOLOGY_SEMANTIC_RANK}`,
  );

  // Предпосылка теста: точных совпадений словоформ нет ни одного, поэтому
  // подняться статья 36 может только за счёт морфологии.
  const queryWords = new Set(surfaceWords(MORPHOLOGY_QUERY_TEXT));
  const sharedSurfaceWords = surfaceWords(MORPHOLOGY_ARTICLE_TITLE).filter(
    (word) => queryWords.has(word),
  );

  assert.deepEqual(
    sharedSurfaceWords,
    [],
    "the fixture must isolate morphology: no exact word form is shared with the query",
  );

  const semanticTopK = MORPHOLOGY_CANDIDATES.slice(0, TOP_K);

  assert.equal(
    containsMorphologyArticle(semanticTopK),
    false,
    `semantic Top-${TOP_K} must not contain article ${MORPHOLOGY_ARTICLE_NUMBER}: ${articleNumbersOf(
      semanticTopK,
    ).join(", ")}`,
  );

  const reranked = rerankLegalCandidates({
    queryText: MORPHOLOGY_QUERY_TEXT,
    candidates: MORPHOLOGY_CANDIDATES,
  });

  const rerankedTopK = reranked.slice(0, TOP_K);

  assert.equal(
    containsMorphologyArticle(rerankedTopK),
    true,
    `reranked Top-${TOP_K} must contain article ${MORPHOLOGY_ARTICLE_NUMBER}: ${articleNumbersOf(
      rerankedTopK,
    ).join(", ")}`,
  );
});

/**
 * RED: parity с эталонным Snowball на замороженном наборе.
 *
 * Поведенческие тесты выше показывают только, что формы одного слова получают
 * общую основу. Они не показывают, что основа та же самая, которую в Colab
 * давал nltk.stem.snowball.SnowballStemmer("russian") — а именно этим
 * стеммером измерялся benchmark, на который опираются alpha и act boost.
 *
 * Таблица ниже — снятый с того же стеммера frozen reference: единственный
 * источник истины для этого шага. Она не выводится из текущей реализации и не
 * дублирует её: private-нормализатор в тест не копируется, второй тестовый
 * стеммер не пишется.
 *
 * Утверждение здесь узкое: parity на этом наборе, а не эквивалентность
 * Snowball на всём русском языке.
 *
 * Для точной проверки косвенного сигнала через ranking недостаточно, поэтому
 * тест требует публичный testable export normalizeRussianToken из того же
 * модуля. Отдельный production-модуль нормализации при этом не вводится.
 */

interface RussianNormalizerModule {
  rerankLegalCandidates: (
    input: RerankLegalCandidatesInput,
  ) => LegalEmbeddingSearchResult[];
  normalizeRussianToken: (token: string) => string;
}

/**
 * Отдельный загрузчик: loadRerankerModule выше проверяет контракт предыдущих
 * тестов и остаётся нетронутым. Модуль существует, поэтому import проходит, а
 * отсутствующий export виден как undefined — на нём тест и падает.
 */
async function loadRussianNormalizerModule(): Promise<RussianNormalizerModule> {
  const loaded = (await import(MODULE)) as Record<string, unknown>;

  assert.equal(
    typeof loaded.rerankLegalCandidates,
    "function",
    `${MODULE} must export rerankLegalCandidates`,
  );

  assert.equal(
    typeof loaded.normalizeRussianToken,
    "function",
    `${MODULE} must export normalizeRussianToken so the Snowball reference set can be checked directly, received ${typeof loaded.normalizeRussianToken}`,
  );

  return loaded as unknown as RussianNormalizerModule;
}

/**
 * Снято в Google Colab тем же nltk.stem.snowball.SnowballStemmer("russian"),
 * которым считался benchmark. Правится только пересъёмкой с того же стеммера.
 */
const SNOWBALL_REFERENCE_STEMS: Array<[string, string]> = [
  ["срок", "срок"],
  ["сроке", "срок"],
  ["сроки", "срок"],
  ["сроков", "срок"],
  ["сроком", "срок"],

  ["договор", "договор"],
  ["договора", "договор"],
  ["договоре", "договор"],
  ["договоров", "договор"],

  ["трудового", "трудов"],
  ["трудовому", "трудов"],
  ["трудовом", "трудов"],
  ["трудовые", "трудов"],
  ["трудов", "труд"],

  ["испытание", "испытан"],
  ["испытания", "испытан"],
  ["испытательном", "испытательн"],
  ["испытательный", "испытательн"],

  ["работник", "работник"],
  ["работника", "работник"],
  ["работнику", "работник"],
  ["работником", "работник"],
  ["работники", "работник"],

  ["потребитель", "потребител"],
  ["потребителя", "потребител"],
  ["потребителю", "потребител"],
  ["потребителем", "потребител"],

  ["обязательство", "обязательств"],
  ["обязательства", "обязательств"],
  ["обязательстве", "обязательств"],

  ["жалоба", "жалоб"],
  ["жалобы", "жалоб"],
  ["жалобе", "жалоб"],
  ["жалобу", "жалоб"],

  ["решение", "решен"],
  ["решения", "решен"],
  ["решении", "решен"],

  ["заявление", "заявлен"],
  ["заявления", "заявлен"],
  ["заявлении", "заявлен"],

  ["продавец", "продавец"],
  ["продавца", "продавц"],
  ["продавцу", "продавц"],

  ["товар", "товар"],
  ["товара", "товар"],
  ["товаре", "товар"],
  ["товары", "товар"],

  ["порядок", "порядок"],
  ["разговор", "разговор"],
  ["работа", "работ"],
  ["заработок", "заработок"],
];

test("Russian token normalization matches the frozen Snowball reference set", async () => {
  const { normalizeRussianToken } = await loadRussianNormalizerModule();

  for (const [input, expectedStem] of SNOWBALL_REFERENCE_STEMS) {
    assert.equal(
      normalizeRussianToken(input),
      expectedStem,
      `Snowball reference: "${input}" must normalize to "${expectedStem}", received "${normalizeRussianToken(
        input,
      )}"`,
    );
  }
});
