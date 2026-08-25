import assert from "node:assert/strict";
import { computeLegalInformationStatus } from "./parse-analysis-result";
import type { LegalSource } from "./types";

function source(
  verification_status: LegalSource["verification_status"],
): LegalSource {
  return {
    title: "Источник",
    act_name: "Закон",
    article: "ст. 1",
    url: null,
    source_domain: null,
    verification_status,
    search_confirmed: false,
  };
}

assert.equal(
  computeLegalInformationStatus([source("official"), source("official")]),
  "official_sources_present",
);

assert.equal(
  computeLegalInformationStatus([source("official"), source("unverified")]),
  "partially_verified",
);

assert.equal(
  computeLegalInformationStatus([source("unverified"), source("not_found")]),
  "unverified",
);

assert.equal(
  computeLegalInformationStatus([source("not_found")]),
  "unverified",
);

console.log("Legal information status checks passed.");
