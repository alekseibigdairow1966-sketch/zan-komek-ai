import { USER_TYPE_LABELS } from "./constants";
import {
  buildActSearchQueries,
  extractProbableActNames,
} from "./extract-probable-act-names";

const RESPONSIBILITY_KEYWORDS = [
  "штраф",
  "ответственност",
  "санкци",
  "взыскан",
  "наказан",
  "убытк",
  "компенсац",
];

const STOP_WORDS = new Set([
  "и",
  "в",
  "на",
  "по",
  "с",
  "у",
  "о",
  "об",
  "от",
  "до",
  "за",
  "для",
  "что",
  "как",
  "это",
  "при",
  "или",
  "не",
  "нет",
  "да",
  "бы",
  "же",
  "ли",
]);

function extractKeywords(description: string, limit = 6): string[] {
  const words = description
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));

  return [...new Set(words)].slice(0, limit);
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();

  return queries
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => {
      if (!query || seen.has(query.toLowerCase())) {
        return false;
      }

      seen.add(query.toLowerCase());
      return true;
    });
}

export function buildLegalSearchQueries(input: {
  legalArea: string;
  userType: string;
  description: string;
}): string[] {
  const description = input.description.trim();
  const legalArea = input.legalArea.trim();
  const userTypeLabel = USER_TYPE_LABELS[input.userType] ?? input.userType;
  const keywords = extractKeywords(description);
  const keywordPart = keywords.length > 0 ? keywords.join(" ") : description.slice(0, 80);
  const actNames = extractProbableActNames({
    legalArea,
    description,
  });

  const queries = [
    `${legalArea} Республика Казахстан законодательство ${keywordPart}`,
    `${legalArea} нормативный правовой акт Республика Казахстан ${keywords[0] ?? "право"}`,
    `права обязанности ${userTypeLabel} ${legalArea} Республика Казахстан ${keywordPart}`,
  ];

  for (const actName of actNames.slice(0, 2)) {
    queries.push(
      ...buildActSearchQueries({
        actName,
        topic: keywordPart,
      }).slice(0, 2),
    );
  }

  const lowerDescription = description.toLowerCase();

  if (
    RESPONSIBILITY_KEYWORDS.some((keyword) =>
      lowerDescription.includes(keyword),
    )
  ) {
    queries.push(
      `ответственность ${legalArea} Республика Казахстан закон ${keywordPart}`,
    );
  }

  return dedupeQueries(queries).slice(0, 8);
}
