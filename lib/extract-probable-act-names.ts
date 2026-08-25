import { getCoreActNames } from "./core-legal-acts";
import { LEGAL_AREAS } from "./constants";

const AREA_ACT_HINTS: Partial<Record<(typeof LEGAL_AREAS)[number], string[]>> = {
  "Персональные данные": [
    'Закон Республики Казахстан "О персональных данных и их защите"',
    "О персональных данных и их защите",
  ],
  "Защита прав потребителей": [
    'Закон Республики Казахстан "О защите прав потребителей"',
  ],
  "Трудовое право": ["Трудовой кодекс Республики Казахстан"],
  "Гражданское право": ["Гражданский кодекс Республики Казахстан"],
  "Налоговое право": ["Налоговый кодекс Республики Казахстан"],
  "Договорное право": ["Гражданский кодекс Республики Казахстан"],
  "Предпринимательское право": [
    "Предпринимательский кодекс Республики Казахстан",
  ],
};

const QUOTED_ACT_RE =
  /[«"']([^»"']{10,120}(?:кодекс|закон|приказ|постановлен)[^»"']{0,80})[»"']/gi;

export function extractProbableActNames(input: {
  legalArea: string;
  description: string;
}): string[] {
  const acts = new Set<string>(getCoreActNames(input));

  const areaActs = AREA_ACT_HINTS[input.legalArea as (typeof LEGAL_AREAS)[number]];
  if (areaActs) {
    for (const act of areaActs) {
      acts.add(act);
    }
  }

  let match: RegExpExecArray | null;
  const quoted = input.description;

  while ((match = QUOTED_ACT_RE.exec(quoted)) !== null) {
    const value = match[1]?.trim();
    if (value) {
      acts.add(value);
    }
  }

  const lower = input.description.toLowerCase();

  if (lower.includes("персональн") && lower.includes("данн")) {
    acts.add('Закон Республики Казахстан "О персональных данных и их защите"');
  }

  if (lower.includes("трудов") && input.legalArea === "Трудовое право") {
    acts.add("Трудовой кодекс Республики Казахстан");
  }

  return [...acts];
}

export function buildActSearchQueries(input: {
  actName: string;
  topic: string;
  article?: string;
}): string[] {
  const actName = input.actName.trim();
  const topic = input.topic.trim();
  const queries = [
    `"${actName}" Республика Казахстан`,
    `"${actName}" adilet.zan.kz`,
    `${actName} ${topic} Республика Казахстан`,
  ];

  if (input.article?.trim()) {
    queries.push(`${actName} ${input.article.trim()} Республика Казахстан`);
  }

  return queries;
}
