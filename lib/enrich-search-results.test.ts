import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRetryQueriesForActs,
  findActsMissingDirectSource,
} from "./enrich-search-results";
import type { LegalSearchResult } from "./types";

const PERSONAL_DATA_ACT =
  'Закон Республики Казахстан "О персональных данных и их защите"';

test("missing direct source triggers retry act detection", () => {
  const relatedOnly: LegalSearchResult[] = [
    {
      title: "О внесении изменений и дополнений в некоторые законодательные акты",
      url: "https://adilet.zan.kz/rus/docs/amendment",
      content: "Внести изменения в Закон о персональных данных и их защите.",
      source_domain: "adilet.zan.kz",
      search_confirmed: true,
      relevance_score: 50,
      relevance_status: "related",
      matched_act_name: PERSONAL_DATA_ACT,
      content_checked: true,
    },
  ];

  const missingActs = findActsMissingDirectSource([PERSONAL_DATA_ACT], relatedOnly);

  assert.deepEqual(missingActs, [PERSONAL_DATA_ACT]);
});

test("retry queries include exact act name in quotes", () => {
  const queries = buildRetryQueriesForActs(
    [PERSONAL_DATA_ACT],
    "персональные данные согласие",
  );

  assert.ok(
    queries.some((query) =>
      query.includes('"Закон Республики Казахстан "О персональных данных и их защите""'),
    ),
  );
  assert.ok(queries.some((query) => query.includes("adilet.zan.kz")));
});
