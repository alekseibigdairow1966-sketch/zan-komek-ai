import {
  PERSONAL_DATA_LAW_KZ,
  isSecondaryAnalysisUrl,
  resolvePrimaryAct,
} from "./core-legal-acts";
import { isOfficialDomain, normalizeHostname } from "./official-domains";
import { normalizeUrlForComparison } from "./normalize-url";
import type { AnalysisRequest, RelevanceStatus } from "./types";

export type ProvisionType =
  | "legal_requirement"
  | "subordinate_rule"
  | "practical_recommendation"
  | "document_template"
  | "technical_recommendation"
  | "secondary_analysis"
  | "unverified_claim";

export interface AuxiliaryProvision {
  id: string;
  topic: string;
  summary: string;
  provision_type: ProvisionType;
  handbook_id: "pd-regulation-handbook";
  official_source_url?: string;
  official_act_reference?: string;
  adaptation_required: boolean;
  verification_required: boolean;
  content_checked: boolean;
  relevance_status: RelevanceStatus;
  source_confirmed: boolean;
  confirms_norm: boolean;
  tags: string[];
}

export const SUBORDINATE_RULE_VERIFICATION_NOTICE =
  "Подзаконное требование требует проверки в отдельном официальном нормативном акте";

export const UNCONFIRMED_SUBORDINATE_PROVISION_IDS = [
  "rule-incident-one-day",
  "rule-database-100k",
  "rule-collection-processing",
  "rule-protection-measures",
] as const;

export interface ClassifyClaimInput {
  claim: string;
  officialSourceUrl?: string | null;
  sourceUrl?: string | null;
  isTemplate?: boolean;
  content_checked?: boolean;
  relevance_status?: RelevanceStatus;
  source_confirmed?: boolean;
  verification_required?: boolean;
}

export interface ProvisionClassification {
  provision_type: ProvisionType;
  confirms_norm: boolean;
  adaptation_required: boolean;
  verification_required: boolean;
  official_source_url?: string;
  reason: string;
}

export const PD_REGULATION_HANDBOOK = {
  id: "pd-regulation-handbook",
  title:
    "Регламент практического применения комплекта документов по обработке персональных данных и оптимизации промптов в Республике Казахстан",
  nature: "auxiliary_source" as const,
};

export const HANDBOOK_RISK_DISCLAIMER =
  "снижает основные выявленные юридические и технические риски, но не заменяет индивидуальную юридическую и техническую проверку";

export const REJECTED_RISK_GUARANTEE_PHRASE =
  "гарантирует устранение всех юридических рисков";

const OFFICIAL_PERSONAL_DATA_LAW_URL = PERSONAL_DATA_LAW_KZ.official_url;

type AuxInput = Omit<
  AuxiliaryProvision,
  "handbook_id" | "content_checked" | "relevance_status" | "source_confirmed" | "confirms_norm"
> & {
  handbook_id?: "pd-regulation-handbook";
  content_checked?: boolean;
  relevance_status?: RelevanceStatus;
  source_confirmed?: boolean;
  confirms_norm?: boolean;
};

function aux(provision: AuxInput): AuxiliaryProvision {
  return {
    handbook_id: "pd-regulation-handbook",
    content_checked: false,
    relevance_status: "irrelevant",
    source_confirmed: false,
    confirms_norm: false,
    ...provision,
  };
}

export function isPrimaryPersonalDataLawUrl(url?: string | null): boolean {
  const normalized = normalizeUrlForComparison(url);
  const mainLaw = normalizeUrlForComparison(OFFICIAL_PERSONAL_DATA_LAW_URL);
  return Boolean(normalized && mainLaw && normalized === mainLaw);
}

const TEMPLATE_PATTERN =
  /шаблон|политик[аи]\s+конфиденциальности|форма\s+согласия|чекбокс|журнал\s+согласий|баннер\s+cookies|ui\/ux|раздел\s+1\.[123]/i;

const BINDING_TOPICS: Array<{
  id: string;
  patterns: RegExp[];
  withOfficial: ProvisionType;
  withoutOfficial: ProvisionType;
  actReference?: string;
}> = [
  {
    id: "data_localization",
    patterns: [/локализац/i, /баз[аы].*территори/i, /физически.*казахстан/i],
    withOfficial: "legal_requirement",
    withoutOfficial: "unverified_claim",
    actReference: "ст. 12 Закона о персональных данных",
  },
  {
    id: "incident_notification",
    patterns: [/один рабочий день/i, /1 рабочий день/i, /уведомлен.*инцидент/i],
    withOfficial: "subordinate_rule",
    withoutOfficial: "unverified_claim",
    actReference: "Правила уведомления о нарушении безопасности ПДн",
  },
  {
    id: "large_database",
    patterns: [/100[\s.]?000/i, /100\s*тыс/i, /биометрическ/i],
    withOfficial: "subordinate_rule",
    withoutOfficial: "unverified_claim",
    actReference: "Требования к базам ограниченного доступа",
  },
  {
    id: "collection_processing_rules",
    patterns: [/правила\s+сбора/i, /сбор.*обработк/i, /принцип\s+минимизац/i],
    withOfficial: "subordinate_rule",
    withoutOfficial: "unverified_claim",
    actReference: "Правила сбора и обработки персональных данных",
  },
  {
    id: "protection_measures",
    patterns: [/меры.*защит/i, /защит.*персональн/i, /шифрован/i],
    withOfficial: "subordinate_rule",
    withoutOfficial: "unverified_claim",
    actReference: "Требования по защите персональных данных",
  },
];

const UNCONFIRMED_LAW_CLAIMS: Array<{
  patterns: RegExp[];
  provision_type: ProvisionType;
  reason: string;
}> = [
  {
    patterns: [/cookie[-\s]?banner/i, /баннер.*cookies/i, /обязательн.*cookies/i],
    provision_type: "practical_recommendation",
    reason: "Cookie-banner не является универсальной прямой нормой закона без отдельного подтверждения",
  },
  {
    patterns: [/универсальн.*3\s*год/i, /стандартно.*3\s*год/i, /срок.*3\s*год/i],
    provision_type: "practical_recommendation",
    reason: "Срок хранения 3 года — практическая рекомендация шаблона, а не универсальная норма закона",
  },
  {
    patterns: [/AES-256/i],
    provision_type: "technical_recommendation",
    reason: "AES-256 — техническая рекомендация без прямой официальной нормы в данном контексте",
  },
  {
    patterns: [/TLS\s*1\.?3/i],
    provision_type: "technical_recommendation",
    reason: "TLS 1.3 — техническая рекомендация без прямой официальной нормы в данном контексте",
  },
  {
    patterns: [/парсинг.*18\s*январ/i, /запрет.*парсинг/i, /18\s*января\s*2026/i],
    provision_type: "unverified_claim",
    reason: "Запрет парсинга с 18 января 2026 не подтверждён прямым официальным актом",
  },
  {
    patterns: [/NDA.*обязател/i, /неразглашен.*всех\s+сотрудник/i],
    provision_type: "practical_recommendation",
    reason: "NDA для всех сотрудников — организационная рекомендация, а не самостоятельная прямая норма закона",
  },
  {
    patterns: [/КДП.*обязател.*частн/i, /государственн.*сервис.*контроля.*обязател.*люб/i],
    provision_type: "practical_recommendation",
    reason: "КДП не является обязательным для любого частного сайта без взаимодействия с гос. объектами информатизации",
  },
];

export const AUXILIARY_PROVISIONS: AuxiliaryProvision[] = [
  aux({
    id: "template-privacy-policy",
    topic: "Шаблон политики конфиденциальности",
    summary:
      "Универсальный текст политики конфиденциальности с заполнителями для адаптации под проект.",
    provision_type: "document_template",
    adaptation_required: true,
    verification_required: true,
    tags: ["политика", "шаблон", "документ"],
  }),
  aux({
    id: "template-consent-form",
    topic: "Шаблон согласия на обработку персональных данных",
    summary: "Форма согласия субъекта с блоками для трансграничной передачи и маркетинга.",
    provision_type: "document_template",
    adaptation_required: true,
    verification_required: true,
    tags: ["согласие", "шаблон"],
  }),
  aux({
    id: "template-ui-checkboxes",
    topic: "Тексты UI-чекбоксов и уведомлений",
    summary:
      "Готовые формулировки чекбоксов обработки, трансграничной передачи, рекламы и AI-предупреждений.",
    provision_type: "document_template",
    adaptation_required: true,
    verification_required: false,
    tags: ["чекбокс", "ui", "интерфейс"],
  }),
  aux({
    id: "template-consent-journal",
    topic: "Спецификация журнала согласий",
    summary:
      "Технические поля consent_id, policy_version, consent_text_hash и др. для фиксации согласий.",
    provision_type: "document_template",
    adaptation_required: true,
    verification_required: false,
    tags: ["журнал", "consent", "разработка"],
  }),
  aux({
    id: "template-cookie-banner",
    topic: "Текст баннера cookies",
    summary: "Шаблон баннера с кнопками «Принять все», «Только необходимые», «Настроить».",
    provision_type: "document_template",
    adaptation_required: true,
    verification_required: true,
    tags: ["cookies", "баннер"],
  }),
  aux({
    id: "rec-storage-3-years",
    topic: "Рекомендуемый срок хранения 3 года",
    summary: "Стандартный срок хранения заявок в шаблоне после завершения взаимодействия.",
    provision_type: "practical_recommendation",
    adaptation_required: true,
    verification_required: true,
    tags: ["срок", "хранение", "3 года"],
  }),
  aux({
    id: "rec-cookie-banner-mandatory",
    topic: "Cookie-banner при первом визите",
    summary: "Практическая рекомендация показывать баннер cookies при первом визите.",
    provision_type: "practical_recommendation",
    adaptation_required: true,
    verification_required: true,
    tags: ["cookies", "баннер"],
  }),
  aux({
    id: "tech-aes-256",
    topic: "Шифрование AES-256",
    summary: "Техническая рекомендация физического шифрования дисков алгоритмом AES-256.",
    provision_type: "technical_recommendation",
    adaptation_required: true,
    verification_required: true,
    tags: ["aes-256", "шифрование"],
  }),
  aux({
    id: "tech-tls-1-3",
    topic: "Протокол TLS 1.3",
    summary: "Техническая рекомендация использования защищённых каналов TLS 1.3.",
    provision_type: "technical_recommendation",
    adaptation_required: true,
    verification_required: true,
    tags: ["tls", "шифрование"],
  }),
  aux({
    id: "claim-parsing-ban-2026",
    topic: "Запрет парсинга с 18 января 2026",
    summary: "Утверждение о запрете сбора данных из открытых источников с указанной даты.",
    provision_type: "unverified_claim",
    adaptation_required: false,
    verification_required: true,
    tags: ["парсинг", "2026"],
  }),
  aux({
    id: "secondary-bluescreen",
    topic: "Аналитическая статья Bluescreen",
    summary: "Обзор требований к архитектуре обработки персональных данных в 2026 году.",
    provision_type: "secondary_analysis",
    adaptation_required: false,
    verification_required: true,
    tags: ["bluescreen", "аналитика"],
  }),
  aux({
    id: "secondary-servercore",
    topic: "Аналитическая статья Servercore",
    summary: "Обзор штрафов и требований Закона № 94-V.",
    provision_type: "secondary_analysis",
    adaptation_required: false,
    verification_required: true,
    tags: ["servercore", "аналитика"],
  }),
  aux({
    id: "secondary-paragraph",
    topic: "Аналитический материал Параграф",
    summary: "Комментарий к Закону о персональных данных на 2026 год.",
    provision_type: "secondary_analysis",
    adaptation_required: false,
    verification_required: true,
    tags: ["параграф", "prg.kz", "аналитика"],
  }),
  aux({
    id: "law-localization-rk",
    topic: "Локализация первичной базы данных в РК",
    summary:
      "Первичная база персональных данных может размещаться на территории Казахстана (ст. 12 основного закона).",
    provision_type: "legal_requirement",
    official_source_url: OFFICIAL_PERSONAL_DATA_LAW_URL,
    official_act_reference:
      "ст. 12 Закона Республики Казахстан «О персональных данных и их защите»",
    adaptation_required: false,
    verification_required: true,
    tags: ["локализация", "база данных"],
  }),
  aux({
    id: "rule-incident-one-day",
    topic: "Уведомление об инциденте за один рабочий день",
    summary:
      "В регламенте предлагается рассмотреть уведомление регулятора об утечке в течение одного рабочего дня; требует проверки в отдельном подзаконном акте.",
    provision_type: "practical_recommendation",
    official_act_reference:
      "Правила уведомления о нарушении безопасности персональных данных",
    adaptation_required: true,
    verification_required: true,
    tags: ["инцидент", "уведомление", "рабочий день"],
  }),
  aux({
    id: "rule-database-100k",
    topic: "Требования к базе более 100 000 записей",
    summary:
      "В регламенте упоминается биометрическая аутентификация для баз свыше 100 тыс. записей; требует проверки в отдельном подзаконном акте.",
    provision_type: "practical_recommendation",
    official_act_reference: "Требования к базам ограниченного доступа",
    adaptation_required: true,
    verification_required: true,
    tags: ["100000", "биометрия", "база"],
  }),
  aux({
    id: "rule-collection-processing",
    topic: "Правила сбора и обработки персональных данных",
    summary:
      "В регламенте описываются принципы минимизации и законности сбора; конкретные правила требуют проверки в отдельном подзаконном акте.",
    provision_type: "practical_recommendation",
    official_act_reference: "Правила сбора и обработки персональных данных",
    adaptation_required: true,
    verification_required: true,
    tags: ["сбор", "обработка", "минимизация"],
  }),
  aux({
    id: "rule-protection-measures",
    topic: "Меры по защите персональных данных",
    summary:
      "В регламенте перечисляются возможные меры защиты (доступ, журналы, резервирование); конкретные требования требуют проверки в отдельном подзаконном акте.",
    provision_type: "practical_recommendation",
    official_act_reference: "Требования по защите персональных данных",
    adaptation_required: true,
    verification_required: true,
    tags: ["защита", "меры", "безопасность"],
  }),
];

export function hasValidOfficialSourceUrl(url?: string | null): boolean {
  if (!url?.trim()) {
    return false;
  }

  try {
    const hostname = normalizeHostname(new URL(url).hostname);
    return isOfficialDomain(hostname);
  } catch {
    return false;
  }
}

export function provisionConfirmsNorm(provision: AuxiliaryProvision): boolean {
  if (
    provision.provision_type !== "legal_requirement" &&
    provision.provision_type !== "subordinate_rule"
  ) {
    return false;
  }

  if (provision.verification_required) {
    return false;
  }

  if (
    !provision.official_source_url ||
    !hasValidOfficialSourceUrl(provision.official_source_url)
  ) {
    return false;
  }

  if (!provision.content_checked) {
    return false;
  }

  if (provision.relevance_status !== "direct") {
    return false;
  }

  if (!provision.source_confirmed) {
    return false;
  }

  if (
    provision.provision_type === "subordinate_rule" &&
    isPrimaryPersonalDataLawUrl(provision.official_source_url)
  ) {
    return false;
  }

  return true;
}

export function getAuxiliaryProvisionDisplayNotice(
  provision: AuxiliaryProvision,
): string | null {
  if (
    UNCONFIRMED_SUBORDINATE_PROVISION_IDS.includes(
      provision.id as (typeof UNCONFIRMED_SUBORDINATE_PROVISION_IDS)[number],
    ) &&
    !provisionConfirmsNorm(provision)
  ) {
    return SUBORDINATE_RULE_VERIFICATION_NOTICE;
  }

  if (
    provision.provision_type === "subordinate_rule" &&
    !provisionConfirmsNorm(provision)
  ) {
    return SUBORDINATE_RULE_VERIFICATION_NOTICE;
  }

  return null;
}

export function getUnconfirmedSubordinateProvisionsForDisplay(): AuxiliaryProvision[] {
  return AUXILIARY_PROVISIONS.filter(
    (provision) =>
      UNCONFIRMED_SUBORDINATE_PROVISION_IDS.includes(
        provision.id as (typeof UNCONFIRMED_SUBORDINATE_PROVISION_IDS)[number],
      ) && !provisionConfirmsNorm(provision),
  );
}

function buildClassifiedProvision(
  input: ClassifyClaimInput,
  topic: (typeof BINDING_TOPICS)[number],
  officialUrl: string,
): ProvisionClassification {
  const isSubordinateTopic = topic.withOfficial === "subordinate_rule";
  const isMainLawOnly = isPrimaryPersonalDataLawUrl(officialUrl);

  if (isSubordinateTopic && isMainLawOnly) {
    return {
      provision_type: "practical_recommendation",
      confirms_norm: false,
      adaptation_required: true,
      verification_required: true,
      official_source_url: officialUrl,
      reason:
        "Основной закон не подтверждает автоматически подзаконную норму; требуется отдельный официальный акт",
    };
  }

  const candidate = aux({
    id: topic.id,
    topic: input.claim,
    summary: input.claim,
    provision_type: topic.withOfficial,
    official_source_url: officialUrl,
    official_act_reference: topic.actReference,
    adaptation_required: false,
    verification_required:
      input.verification_required ?? topic.withOfficial === "subordinate_rule",
    content_checked: input.content_checked ?? false,
    relevance_status: input.relevance_status ?? "irrelevant",
    source_confirmed: input.source_confirmed ?? false,
    confirms_norm: true,
    tags: [],
  });

  const confirms_norm = provisionConfirmsNorm(candidate);

  if (!confirms_norm && isSubordinateTopic) {
    return {
      provision_type: "practical_recommendation",
      confirms_norm: false,
      adaptation_required: true,
      verification_required: true,
      official_source_url: officialUrl,
      reason: SUBORDINATE_RULE_VERIFICATION_NOTICE,
    };
  }

  return {
    provision_type: topic.withOfficial,
    confirms_norm,
    adaptation_required: !confirms_norm,
    verification_required: !confirms_norm,
    official_source_url: officialUrl,
    reason: confirms_norm
      ? `Положение подтверждается официальным источником: ${topic.actReference ?? topic.id}`
      : `Требуется привязка к прямому официальному акту: ${topic.actReference ?? topic.id}`,
  };
}

export function classifyAuxiliaryClaim(
  input: ClassifyClaimInput,
): ProvisionClassification {
  const claim = input.claim.trim();

  if (input.isTemplate || TEMPLATE_PATTERN.test(claim)) {
    return {
      provision_type: "document_template",
      confirms_norm: false,
      adaptation_required: true,
      verification_required: true,
      reason: "Шаблон документа не подтверждает правовую норму сам по себе",
    };
  }

  if (input.sourceUrl && isSecondaryAnalysisUrl(input.sourceUrl)) {
    return {
      provision_type: "secondary_analysis",
      confirms_norm: false,
      adaptation_required: false,
      verification_required: true,
      reason: "Аналитическая статья не подтверждает правовую норму",
    };
  }

  if (/bluescreen|servercore|параграф|prg\.kz/i.test(claim)) {
    return {
      provision_type: "secondary_analysis",
      confirms_norm: false,
      adaptation_required: false,
      verification_required: true,
      reason: "Материалы Bluescreen, Servercore и Параграф — вторичный анализ",
    };
  }

  for (const unconfirmed of UNCONFIRMED_LAW_CLAIMS) {
    if (unconfirmed.patterns.some((pattern) => pattern.test(claim))) {
      return {
        provision_type: unconfirmed.provision_type,
        confirms_norm: false,
        adaptation_required: unconfirmed.provision_type === "practical_recommendation",
        verification_required: true,
        reason: unconfirmed.reason,
      };
    }
  }

  const officialUrl = hasValidOfficialSourceUrl(input.officialSourceUrl)
    ? input.officialSourceUrl ?? undefined
    : undefined;

  for (const topic of BINDING_TOPICS) {
    if (!topic.patterns.some((pattern) => pattern.test(claim))) {
      continue;
    }

    if (officialUrl) {
      return buildClassifiedProvision(input, topic, officialUrl);
    }

    return {
      provision_type: topic.withoutOfficial,
      confirms_norm: false,
      adaptation_required: false,
      verification_required: true,
      reason: `Требуется привязка к прямому официальному акту: ${topic.actReference ?? topic.id}`,
    };
  }

  return {
    provision_type: "practical_recommendation",
    confirms_norm: false,
    adaptation_required: true,
    verification_required: true,
    reason: "Положение из вспомогательного регламента без прямого официального подтверждения",
  };
}

export function sanitizeHandbookRiskPhrase(text: string): string {
  if (!text.includes(REJECTED_RISK_GUARANTEE_PHRASE)) {
    return text;
  }

  return text.replace(
    REJECTED_RISK_GUARANTEE_PHRASE,
    HANDBOOK_RISK_DISCLAIMER,
  );
}

export function shouldIncludeAuxiliaryHandbook(request: AnalysisRequest): boolean {
  return Boolean(
    resolvePrimaryAct({
      legalArea: request.legalArea,
      description: request.description,
    }),
  );
}

function formatProvisionLine(provision: AuxiliaryProvision): string {
  const parts = [
    `- [${provision.provision_type}] ${provision.topic}: ${provision.summary}`,
  ];

  if (provision.official_source_url) {
    parts.push(`  official_source_url: ${provision.official_source_url}`);
  }

  if (provision.official_act_reference) {
    parts.push(`  act_reference: ${provision.official_act_reference}`);
  }

  parts.push(
    `  confirms_norm: ${provisionConfirmsNorm(provision) ? "да" : "нет"}`,
  );
  parts.push(
    `  content_checked: ${provision.content_checked ? "да" : "нет"}`,
  );
  parts.push(`  relevance_status: ${provision.relevance_status}`);
  parts.push(`  source_confirmed: ${provision.source_confirmed ? "да" : "нет"}`);
  parts.push(
    `  adaptation_required: ${provision.adaptation_required ? "да" : "нет"}`,
  );
  parts.push(
    `  verification_required: ${provision.verification_required ? "да" : "нет"}`,
  );

  return parts.join("\n");
}

export function buildAuxiliaryProvisionsPromptBlock(): string {
  const grouped = new Map<ProvisionType, AuxiliaryProvision[]>();

  for (const provision of AUXILIARY_PROVISIONS) {
    const list = grouped.get(provision.provision_type) ?? [];
    list.push(provision);
    grouped.set(provision.provision_type, list);
  }

  const sections = [...grouped.entries()].map(([type, provisions]) => {
    return `${type}:\n${provisions.map(formatProvisionLine).join("\n")}`;
  });

  return `ВСПОМОГАТЕЛЬНЫЙ РЕГЛАМЕНТ (НЕ НОРМАТИВНЫЙ АКТ):
title: ${PD_REGULATION_HANDBOOK.title}
handbook_id: ${PD_REGULATION_HANDBOOK.id}
nature: ${PD_REGULATION_HANDBOOK.nature}
risk_disclaimer: ${HANDBOOK_RISK_DISCLAIMER}

Извлечённые положения по типам:
${sections.join("\n\n")}

Правила использования вспомогательного регламента:
1. legal_requirement подтверждается только если норма содержится в загруженном тексте основного закона (content_checked, relevance_status=direct, source_confirmed).
2. subordinate_rule подтверждается только при прямом URL конкретного подзаконного акта, а не основного закона Z1300000094.
3. URL основного закона нельзя использовать для подтверждения срока уведомления об инциденте, требований к базе >100 000 записей, правил сбора/обработки и технических мер защиты.
4. document_template, practical_recommendation и technical_recommendation не подтверждают обязательную норму закона.
5. secondary_analysis (Bluescreen, Servercore, Параграф) — только пояснения и поисковые подсказки, без официального бейджа.
6. unverified_claim всегда требует дополнительной проверки и не может быть выдан как закон.
7. Для неподтверждённых подзаконных положений используй формулировку: «${SUBORDINATE_RULE_VERIFICATION_NOTICE}».
8. Не используй категоричные формулировки «обязан», «требуется», «закон устанавливает» для practical_recommendation и unverified_claim.
9. При генерации или рекомендации документов явно указывай: что основано на законе; что является практической рекомендацией; что требует адаптации; что требует дополнительной проверки.
10. Не используй формулировку «${REJECTED_RISK_GUARANTEE_PHRASE}». Используй: «${HANDBOOK_RISK_DISCLAIMER}».`;
}
