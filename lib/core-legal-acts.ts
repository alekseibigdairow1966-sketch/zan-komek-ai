import type { LegalArea } from "./types";
import { actNameMatchesText, actNameMatchesTitle } from "./evaluate-source-relevance";
import type { RelevanceStatus, SourceType } from "./types";

export interface CoreLegalAct {
  id: string;
  title: string;
  aliases: string[];
  legal_area: LegalArea[];
  official_url: string;
  official_domain: string;
  keywords: string[];
}

export interface CuratedOfficialSource {
  id: string;
  title: string;
  url: string;
  official_domain: string;
  source_type: Exclude<SourceType, "legal_act" | "secondary_analysis">;
  relevance_status: Extract<RelevanceStatus, "related">;
  matched_act_id: string;
  trigger_keywords: string[];
}

export const PERSONAL_DATA_LAW_KZ: CoreLegalAct = {
  id: "personal-data-law-kz",
  title: "Закон Республики Казахстан «О персональных данных и их защите»",
  aliases: [
    "О персональных данных и их защите",
    "Закон о персональных данных",
    "Закон о ПДн",
  ],
  legal_area: [
    "Персональные данные",
    "Цифровое право",
    "Предпринимательское право",
  ],
  official_url: "https://adilet.zan.kz/rus/docs/Z1300000094",
  official_domain: "adilet.zan.kz",
  keywords: [
    "персональные данные",
    "согласие",
    "имя",
    "телефон",
    "форма заявки",
    "политика конфиденциальности",
    "обработка данных",
    "хранение данных",
    "передача данных",
    "трансграничная передача",
    "crm",
    "cookies",
  ],
};

export const CONSUMER_PROTECTION_LAW_KZ: CoreLegalAct = {
  id: "consumer-protection-law-kz",
  title: "Закон Республики Казахстан «О защите прав потребителей»",
  aliases: ["О защите прав потребителей", "Закон о защите прав потребителей"],
  legal_area: ["Защита прав потребителей"],
  official_url: "https://adilet.zan.kz/rus/docs/Z100000274_",
  official_domain: "adilet.zan.kz",
  keywords: ["потребитель", "защита прав потребителей"],
};

export const LABOUR_CODE_KZ: CoreLegalAct = {
  id: "labour-code-kz",
  title: "Трудовой кодекс Республики Казахстан",
  aliases: ["Трудовой кодекс", "ТК РК"],
  legal_area: ["Трудовое право"],
  official_url: "https://adilet.zan.kz/rus/docs/K1500000414",
  official_domain: "adilet.zan.kz",
  keywords: ["трудовой договор", "увольнение"],
};

export const CIVIL_CODE_GENERAL_KZ: CoreLegalAct = {
  id: "civil-code-general-kz",
  title: "Гражданский кодекс Республики Казахстан (Общая часть)",
  aliases: [
    "Гражданский кодекс Республики Казахстан (Общая часть)",
    "ГК РК",
  ],
  legal_area: ["Гражданское право"],
  official_url: "https://adilet.zan.kz/rus/docs/K940001000_",
  official_domain: "adilet.zan.kz",
  keywords: ["сделка", "обязательство"],
};

export const CIVIL_CODE_SPECIAL_KZ: CoreLegalAct = {
  id: "civil-code-special-kz",
  title: "Гражданский кодекс Республики Казахстан (особенная часть)",
  aliases: [
    "Гражданский кодекс Республики Казахстан (особенная часть)",
    "ГК РК особенная часть",
  ],
  legal_area: ["Гражданское право", "Договорное право"],
  official_url: "https://adilet.zan.kz/rus/docs/K990000409_",
  official_domain: "adilet.zan.kz",
  keywords: ["договор", "купля-продажа"],
};

export const ENTREPRENEURIAL_CODE_KZ: CoreLegalAct = {
  id: "entrepreneurial-code-kz",
  title: "Предпринимательский кодекс Республики Казахстан",
  aliases: ["Предпринимательский кодекс", "ПК РК"],
  legal_area: ["Предпринимательское право"],
  official_url: "https://adilet.zan.kz/rus/docs/K1500000375",
  official_domain: "adilet.zan.kz",
  keywords: ["предпринимательская деятельность", "бизнес"],
};

export const ADMINISTRATIVE_PROCEDURE_CODE_KZ: CoreLegalAct = {
  id: "administrative-procedure-code-kz",
  title:
    "Административный процедурно-процессуальный кодекс Республики Казахстан",
  aliases: [
    "Административный процедурно-процессуальный кодекс",
    "АППК РК",
  ],
  legal_area: ["Другое"],
  official_url: "https://adilet.zan.kz/rus/docs/K2000000350",
  official_domain: "adilet.zan.kz",
  keywords: ["административная процедура", "административный акт"],
};

export const CORE_LEGAL_ACTS: CoreLegalAct[] = [
  PERSONAL_DATA_LAW_KZ,
  CONSUMER_PROTECTION_LAW_KZ,
  LABOUR_CODE_KZ,
  CIVIL_CODE_GENERAL_KZ,
  CIVIL_CODE_SPECIAL_KZ,
  ENTREPRENEURIAL_CODE_KZ,
  ADMINISTRATIVE_PROCEDURE_CODE_KZ,
];

export const CURATED_OFFICIAL_SOURCES: CuratedOfficialSource[] = [
  {
    id: "kdp-access-control-guidance",
    title:
      "Государственный сервис контроля доступа к персональным данным (официальный материал gov.kz)",
    url: "https://www.gov.kz/memleket/entities/infsecurity/press/article/details/130936",
    official_domain: "gov.kz",
    source_type: "official_guidance",
    relevance_status: "related",
    matched_act_id: "personal-data-law-kz",
    trigger_keywords: [
      "кдп",
      "контроль доступа",
      "персональн",
      "государственн",
      "интеграц",
    ],
  },
  {
    id: "maid-digital-authority",
    title: "Министерство искусственного интеллекта и цифрового развития РК",
    url: "https://www.gov.kz/memleket/entities/maidd",
    official_domain: "gov.kz",
    source_type: "official_authority",
    relevance_status: "related",
    matched_act_id: "personal-data-law-kz",
    trigger_keywords: ["персональн", "цифров", "министерств", "госорган"],
  },
];

export const SECONDARY_ANALYSIS_DOMAINS = [
  "bluescreen.kz",
  "servercore.com",
  "prg.kz",
] as const;

export const BLUESCREEN_PERSONAL_DATA_URL =
  "https://bluescreen.kz/piersonalnyie-dannyie-v-2026-ghodu-po-novomu-chto-zakon-tiepier-triebuiet-ot-vashiei-arkhitiektury-a-nie-tolko-ot-dokumientov/";

export const SERVERCORE_PERSONAL_DATA_URL =
  "https://servercore.com/ru/blog/articles/kz-zakon-o-personalnyh-dannyh/";

export const PARAGRAPH_PERSONAL_DATA_URL =
  "https://prg.kz/document/?doc_id=31396226";

export function normalizeKeyword(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchesActKeywords(
  description: string,
  act: CoreLegalAct,
): boolean {
  const lower = normalizeKeyword(description);

  return act.keywords.some((keyword) => lower.includes(normalizeKeyword(keyword)));
}

export function resolvePrimaryAct(input: {
  legalArea: string;
  description: string;
}): CoreLegalAct | undefined {
  const normalizedLegalArea = normalizeKeyword(input.legalArea);

  for (const act of CORE_LEGAL_ACTS) {
    const areaMatches = act.legal_area.some(
      (area) => normalizeKeyword(area) === normalizedLegalArea,
    );

    if (areaMatches || matchesActKeywords(input.description, act)) {
      return act;
    }
  }

  return undefined;
}

export function getActById(id: string): CoreLegalAct | undefined {
  return CORE_LEGAL_ACTS.find((act) => act.id === id);
}

export function actContentMatchesAct(
  act: CoreLegalAct,
  title: string,
  text: string,
): boolean {
  const candidates = [act.title, ...act.aliases];

  return candidates.some(
    (name) =>
      actNameMatchesTitle(title, name) || actNameMatchesText(text, name),
  );
}

export function getCuratedSourcesForAct(
  act: CoreLegalAct,
  description: string,
): CuratedOfficialSource[] {
  const lower = normalizeKeyword(description);

  return CURATED_OFFICIAL_SOURCES.filter((source) => {
    if (source.matched_act_id !== act.id) {
      return false;
    }

    return source.trigger_keywords.some((keyword) =>
      lower.includes(normalizeKeyword(keyword)),
    );
  });
}

export function isSecondaryAnalysisDomain(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }

  const normalized = hostname.trim().toLowerCase().replace(/^www\./, "");

  return SECONDARY_ANALYSIS_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

export function isSecondaryAnalysisUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname;
    return isSecondaryAnalysisDomain(hostname);
  } catch {
    return false;
  }
}

export function getCoreActNames(input: {
  legalArea: string;
  description: string;
}): string[] {
  const names = new Set<string>();
  const primaryAct = resolvePrimaryAct(input);

  if (primaryAct) {
    names.add(primaryAct.title);
    for (const alias of primaryAct.aliases) {
      names.add(alias);
    }
  }

  return [...names];
}
