import type { ApplicableLaw, LegalAnalysisResult, LegalSource, SourceDisplayBadge, VerificationStatus } from "@/lib/types";
import {
  getApplicableLawRelevanceBadge,
  getSourceDisplayBadge,
} from "@/lib/confirm-sources-with-search";
import {
  getAuxiliaryProvisionDisplayNotice,
  getUnconfirmedSubordinateProvisionsForDisplay,
} from "@/lib/auxiliary-provisions";
import { resolveApplicableLawArticle } from "@/lib/parse-applicable-laws";
import {
  SOURCE_VERIFICATION_LIMITATION_NOTICE,
  VERIFICATION_STATUS_LABELS,
} from "@/lib/types";

interface AnalysisResultProps {
  result: LegalAnalysisResult;
}

const STATUS_BANNER_STYLES = {
  official_sources_present:
    "border-emerald-200 bg-emerald-50 text-emerald-900",
  partially_verified: "border-amber-200 bg-amber-50 text-amber-900",
  unverified: "border-red-200 bg-red-50 text-red-900",
} as const;

const SOURCE_BADGE_STYLES: Record<SourceDisplayBadge, string> = {
  "Подтверждённый официальный источник":
    "border-emerald-200 bg-emerald-50 text-emerald-800",
  "Связанный официальный материал":
    "border-amber-200 bg-amber-50 text-amber-800",
  "Найдено через официальный поиск":
    "border-emerald-200 bg-emerald-50 text-emerald-800",
  "Официальный домен": "border-blue-200 bg-blue-50 text-blue-800",
  "Не подтверждено поиском": "border-amber-200 bg-amber-50 text-amber-800",
  "Источник не найден": "border-slate-200 bg-slate-100 text-slate-700",
};

const VERIFICATION_BADGE_STYLES = {
  official: "border-emerald-200 bg-emerald-50 text-emerald-800",
  unverified: "border-amber-200 bg-amber-50 text-amber-800",
  not_found: "border-slate-200 bg-slate-100 text-slate-700",
} as const;

const TEXT_SECTIONS = [
  { key: "legalAssessment" as const, title: "Правовая оценка" },
  { key: "analysis" as const, title: "Анализ" },
  { key: "riskAnalysis" as const, title: "Анализ рисков" },
  { key: "confidenceLevel" as const, title: "Уровень уверенности" },
  { key: "relevanceDate" as const, title: "Дата актуальности" },
] as const;

const LIST_SECTIONS = [
  { key: "recommendedActions" as const, title: "Рекомендуемые действия" },
  { key: "requiredDocuments" as const, title: "Перечень документов" },
] as const;

const LAW_RELEVANCE_BADGE_STYLES = {
  "Прямой официальный источник":
    "border-emerald-200 bg-emerald-50 text-emerald-800",
  "Связанный официальный материал":
    "border-amber-200 bg-amber-50 text-amber-800",
  "Не подтверждено": "border-slate-200 bg-slate-100 text-slate-700",
} as const;

export function resolveApplicableLawVerificationBadge(
  verificationStatus: VerificationStatus,
  sourceConfirmed?: boolean,
): { label: string; style: string } {
  if (verificationStatus === "official" && sourceConfirmed !== true) {
    return {
      label: "Официальный домен",
      style: SOURCE_BADGE_STYLES["Официальный домен"],
    };
  }

  return {
    label: VERIFICATION_STATUS_LABELS[verificationStatus],
    style: VERIFICATION_BADGE_STYLES[verificationStatus],
  };
}

export function resolveApplicableLawArticleVerificationBadge(
  law: ApplicableLaw,
):
  | {
      label: string;
      tone: "confirmed" | "warning";
    }
  | null {
  if (law.source_confirmed !== true) {
    return null;
  }

  const article = law.article?.trim();

  if (!article) {
    return null;
  }

  if (law.source_article) {
    return {
      label: `Статья ${law.source_article.number} подтверждена`,
      tone: "confirmed",
    };
  }

  return {
    label: "Конкретная статья не подтверждена",
    tone: "warning",
  };
}

function ApplicableLawItem({ law }: { law: ApplicableLaw }) {
  const article = resolveApplicableLawArticle(law);
  const articleVerificationBadge =
    resolveApplicableLawArticleVerificationBadge(law);
  const status: VerificationStatus = law.verification_status ?? "unverified";
  const { label: verificationLabel, style: verificationStyle } =
    resolveApplicableLawVerificationBadge(status, law.source_confirmed);
  const relevanceBadge = getApplicableLawRelevanceBadge(
    law.source_relevance_status,
    law.source_confirmed,
  );
  const sourceArticleUrl =
    articleVerificationBadge?.tone === "confirmed" &&
    law.source_url &&
    law.source_article?.anchor
      ? `${law.source_url}${law.source_article.anchor}`
      : undefined;

  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-900">{law.act_name}</p>
          {article ? (
            <p className="text-sm text-slate-600">{article}</p>
          ) : null}
          {articleVerificationBadge ? (
            sourceArticleUrl ? (
              <a
                href={sourceArticleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
              >
                {articleVerificationBadge.label}
              </a>
            ) : (
              <span
                className={
                  articleVerificationBadge.tone === "confirmed"
                    ? "inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800"
                    : "inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800"
                }
              >
                {articleVerificationBadge.label}
              </span>
            )
          ) : null}
          {law.provision ? (
            <p className="text-sm text-slate-700">{law.provision}</p>
          ) : null}
          {law.explanation ? (
            <p className="text-sm text-slate-500">{law.explanation}</p>
          ) : null}
          {law.source_url ? (
            <a
              href={law.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-sm text-blue-700 underline-offset-2 hover:underline"
            >
              {law.source_url}
            </a>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${verificationStyle}`}
          >
            {verificationLabel}
          </span>
          <span
            className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${LAW_RELEVANCE_BADGE_STYLES[relevanceBadge as keyof typeof LAW_RELEVANCE_BADGE_STYLES] ?? LAW_RELEVANCE_BADGE_STYLES["Не подтверждено"]}`}
          >
            {relevanceBadge}
          </span>
        </div>
      </div>
    </li>
  );
}

function SourceItem({ source }: { source: LegalSource }) {
  const badge = getSourceDisplayBadge(source);

  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-900">{source.title}</p>
          <p className="text-sm text-slate-700">{source.act_name}</p>
          <p className="text-sm text-slate-600">{source.article}</p>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-sm text-blue-700 underline-offset-2 hover:underline"
            >
              {source.url}
            </a>
          ) : source.source_domain ? (
            <p className="text-sm text-slate-500">
              {badge === "Официальный домен"
                ? `Официальный домен без подтверждения поиском: ${source.source_domain}`
                : `Домен: ${source.source_domain}`}
            </p>
          ) : (
            <p className="text-sm text-slate-500">Ссылка не указана</p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${SOURCE_BADGE_STYLES[badge]}`}
        >
          {badge}
        </span>
      </div>
    </li>
  );
}

export function AnalysisResult({ result }: AnalysisResultProps) {
  const unconfirmedSubordinateProvisions =
    result.primary_legal_act?.id === "personal-data-law-kz"
      ? getUnconfirmedSubordinateProvisionsForDisplay()
      : [];

  return (
    <section
      aria-labelledby="analysis-result-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2
        id="analysis-result-title"
        className="text-xl font-semibold text-slate-900"
      >
        Результат юридического анализа
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Информационный анализ на основе описанной ситуации
      </p>

      <div
        className={`mt-6 rounded-xl border px-4 py-3 text-sm leading-relaxed ${STATUS_BANNER_STYLES[result.legal_information_status]}`}
        role="status"
      >
        {result.legal_information_notice}
      </div>

      {result.verified_by_search ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Найдены прямые официальные источники, подтверждённые поиском Tavily и
          проверкой релевантности страницы.
        </p>
      ) : null}

      {result.search_notice ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {result.search_notice}
        </p>
      ) : null}

      {unconfirmedSubordinateProvisions.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Вспомогательный регламент: подзаконные положения</p>
          <ul className="mt-2 space-y-2">
            {unconfirmedSubordinateProvisions.map((provision) => (
              <li key={provision.id}>
                <span className="font-medium">{provision.topic}:</span>{" "}
                {getAuxiliaryProvisionDisplayNotice(provision)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        {SOURCE_VERIFICATION_LIMITATION_NOTICE}
      </p>

      <p className="mt-2 text-xs text-slate-400">
        Сформировано:{" "}
        {new Date(result.generated_at).toLocaleString("ru-RU", {
          timeZone: "Asia/Almaty",
        })}
      </p>

      <div className="mt-8 space-y-8">
        {TEXT_SECTIONS.map((section) => (
          <div key={section.key}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              {section.title}
            </h3>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {result[section.key]}
            </p>
          </div>
        ))}

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
            Применимые нормы законодательства
          </h3>
          <ul className="mt-3 space-y-3">
            {result.applicableLaws.map((law, index) => (
              <ApplicableLawItem key={`law-${index}`} law={law} />
            ))}
          </ul>
        </div>

        {LIST_SECTIONS.map((section) => (
          <div key={section.key}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              {section.title}
            </h3>
            <ul className="mt-3 space-y-2">
              {result[section.key].map((item, index) => (
                <li
                  key={`${section.key}-${index}`}
                  className="flex items-start gap-3 text-sm leading-relaxed text-slate-700"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600"
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
            Источники
          </h3>
          <ul className="mt-3 space-y-3">
            {result.sources.map((source, index) => (
              <SourceItem key={`source-${index}`} source={source} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
