import type { LegalEmbeddingSearchResult } from "./search-legal-embedding-records";

/**
 * Pure hybrid reranking of semantic retrieval candidates.
 *
 * Ranking and relevance only. This module never reads, creates or changes
 * source_confirmed, search_confirmed, content_checked or verification_status:
 * semantic proximity is not legal verification, and confirmation stays with
 * the existing verification pipeline.
 *
 * No I/O, no network, no OpenAI, no artifact: a candidate array in, a reordered
 * candidate array out. Not wired into the runtime retriever at this stage.
 *
 * The coefficients come from the Colab experiment recorded in
 * data/benchmarks/zankomek_rag_benchmark_20_report.json (candidate pool 50,
 * title overlap alpha 0.15, predicted act soft boost 0.05). They are a starting
 * point measured on 20 cases, not a settled production configuration.
 */

/** Weight of the title overlap signal, added on top of the semantic score. */
export const TITLE_OVERLAP_ALPHA = 0.15;

/** Soft bonus for the act predicted by the semantic top candidate. */
export const PREDICTED_ACT_BOOST = 0.05;

export interface RerankLegalCandidatesInput {
  queryText: string;
  candidates: LegalEmbeddingSearchResult[];
}

interface ScoredCandidate {
  candidate: LegalEmbeddingSearchResult;
  hybridScore: number;
  incomingIndex: number;
}

/** Everything that is not a letter separates tokens, digits included. */
const NON_LETTER_PATTERN = /[^\p{L}]+/gu;

/**
 * Light deterministic Russian suffix normalization.
 *
 * This is NOT Snowball, NOT Porter and NOT a morphological analyzer: it knows
 * no lexicon, no part of speech and no exceptions. It strips one inflectional
 * ending from a word form so that «срок» / «сроке», «договора» / «договоре»
 * and «трудового» / «трудовому» / «трудовом» collapse onto a shared stem.
 *
 * The endings below are the ordinary case endings of Russian nouns and
 * adjectives, applied as a general rule — there is no entry for any particular
 * word.
 *
 * Validated against a frozen Snowball reference set: 51 word forms stemmed in
 * Colab with nltk.stem.snowball.SnowballStemmer("russian"), the same stemmer
 * the benchmark was measured with, are reproduced exactly (see
 * rerank-legal-candidates.test.ts). That is parity on those 51 cases and
 * nothing wider — this is not a Snowball implementation and is not claimed to
 * agree with it across Russian generally.
 */
const RUSSIAN_INFLECTIONAL_ENDINGS: string[] = [
  // Longest first, so a three-letter ending is never mistaken for a shorter
  // one hiding inside it.
  "ами",
  "ями",
  "ого",
  "его",
  "ому",
  "ему",
  "ыми",
  "ими",
  "ов",
  "ев",
  "ах",
  "ях",
  "ам",
  "ям",
  "ом",
  "ем",
  "ой",
  "ей",
  "ый",
  "ий",
  "ая",
  "яя",
  "ое",
  "ее",
  "ые",
  "ие",
  "ую",
  "юю",
  "ью",
  "ия",
  "ии",
  "ья",
  "ье",
  "а",
  "я",
  "о",
  "е",
  "ы",
  "и",
  "у",
  "ю",
  "ь",
  "й",
];

/** Below this the remainder stops being a stem and starts being noise. */
const MIN_STEM_LENGTH = 3;

/**
 * Strips at most one ending, and only when a stem of a reasonable length is
 * left behind — so short words such as «срок» or «три» are returned untouched.
 */
export function normalizeRussianToken(token: string): string {
  for (const ending of RUSSIAN_INFLECTIONAL_ENDINGS) {
    if (
      token.length - ending.length >= MIN_STEM_LENGTH &&
      token.endsWith(ending)
    ) {
      return token.slice(0, token.length - ending.length);
    }
  }

  return token;
}

/**
 * lowercase, ё → е, &nbsp; as a space, every non-letter as a separator, then
 * the same suffix normalization for every token. Applied identically to the
 * query and to article_title, so both sides are compared in one form.
 */
function tokenize(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/ё/g, "е")
    .replace(NON_LETTER_PATTERN, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeRussianToken);
}

/**
 * Share of the title that the query also mentions. Normalised by the title, so
 * a short precise heading is not penalised against a long one, and a missing
 * article_title scores 0 instead of throwing.
 */
function titleOverlap(queryTokens: Set<string>, title: string | undefined): number {
  const titleTokens = new Set(tokenize(title));

  if (titleTokens.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of titleTokens) {
    if (queryTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / titleTokens.size;
}

/**
 * Reorders the candidates by hybrid score, highest first.
 *
 * hybridScore = retrieval_score
 *             + TITLE_OVERLAP_ALPHA * titleOverlap(query, article_title)
 *             + (act_id === predictedActId ? PREDICTED_ACT_BOOST : 0)
 *
 * The predicted act is the act of the semantic top candidate and acts only as
 * a bonus: candidates from every other act stay in the pool and can still win.
 * There is no filtering of any kind, so the returned array holds exactly the
 * candidates it received.
 *
 * retrieval_score of the returned copies carries the hybrid score, because the
 * retrieval layer treats that field as the value the results are ordered by.
 * The input array and the input objects are left untouched.
 */
export function rerankLegalCandidates(
  input: RerankLegalCandidatesInput,
): LegalEmbeddingSearchResult[] {
  if (input.candidates.length === 0) {
    return [];
  }

  const queryTokens = new Set(tokenize(input.queryText));
  const predictedActId = input.candidates[0].act_id;

  const scored: ScoredCandidate[] = input.candidates.map(
    (candidate, incomingIndex) => {
      const titleSignal =
        TITLE_OVERLAP_ALPHA * titleOverlap(queryTokens, candidate.article_title);
      const actSignal =
        candidate.act_id === predictedActId ? PREDICTED_ACT_BOOST : 0;

      return {
        candidate,
        hybridScore: candidate.retrieval_score + titleSignal + actSignal,
        incomingIndex,
      };
    },
  );

  // Explicit index tie-break: equal hybrid scores keep the incoming semantic
  // order, so the ranking never depends on the sort implementation.
  scored.sort((left, right) => {
    if (left.hybridScore !== right.hybridScore) {
      return right.hybridScore - left.hybridScore;
    }

    return left.incomingIndex - right.incomingIndex;
  });

  return scored.map((entry) => ({
    ...entry.candidate,
    retrieval_score: entry.hybridScore,
  }));
}
