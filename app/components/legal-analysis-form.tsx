"use client";

import { useState } from "react";
import {
  LEGAL_AREAS,
  MIN_DESCRIPTION_LENGTH,
  USER_TYPES,
} from "@/lib/constants";
import { MAX_DOCUMENT_BYTES } from "@/lib/extract-document-text";
import type { AnalysisErrorResponse, LegalAnalysisResult } from "@/lib/types";
import { AnalysisResult } from "./analysis-result";

const BENEFITS = [
  "Правовая оценка",
  "Применимые нормы законодательства",
  "Анализ рисков",
  "Пошаговый план действий",
  "Перечень документов",
  "Официальные источники",
] as const;

type LoadingPhase = "idle" | "searching" | "analyzing";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function LegalAnalysisForm() {
  const [legalArea, setLegalArea] = useState<string>(LEGAL_AREAS[0]);
  const [userType, setUserType] = useState<string>(USER_TYPES[0].value);
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LegalAnalysisResult | null>(null);

  const isLoading = loadingPhase !== "idle";
  const hasValidDescription =
    description.trim().length >= MIN_DESCRIPTION_LENGTH;
  const canSubmit =
    consent &&
    !isLoading &&
    (documentFile !== null || hasValidDescription);

  function handleDocumentFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      setDocumentFile(null);
      return;
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setDocumentFile(null);
      setError("Поддерживается только формат DOCX.");
      event.target.value = "";
      return;
    }

    if (file.type !== DOCX_MIME) {
      setDocumentFile(null);
      setError("Поддерживается только MIME-тип DOCX.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_DOCUMENT_BYTES) {
      setDocumentFile(null);
      setError("Размер файла не должен превышать 1 МБ.");
      event.target.value = "";
      return;
    }

    setError(null);
    setDocumentFile(file);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setLoadingPhase("searching");
    setError(null);
    setResult(null);

    const analyzingTimer = window.setTimeout(() => {
      setLoadingPhase("analyzing");
    }, 1200);

    try {
      let response: Response;

      if (documentFile) {
        const formData = new FormData();
        formData.set("legalArea", legalArea);
        formData.set("userType", userType);
        formData.set("description", description.trim());
        formData.set("consent", String(consent));
        formData.set("document", documentFile);

        response = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legalArea,
            userType,
            description: description.trim(),
            consent,
          }),
        });
      }

      const data = (await response.json()) as
        | { result: LegalAnalysisResult }
        | AnalysisErrorResponse;

      if (!response.ok) {
        const errorMessage =
          "error" in data ? data.error : "Не удалось выполнить анализ";
        throw new Error(errorMessage);
      }

      if (!("result" in data)) {
        throw new Error("Некорректный ответ сервера");
      }

      setResult(data.result);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Произошла непредвиденная ошибка",
      );
    } finally {
      window.clearTimeout(analyzingTimer);
      setLoadingPhase("idle");
    }
  }

  const loadingLabel =
    loadingPhase === "searching"
      ? "Поиск официальных нормативных источников…"
      : loadingPhase === "analyzing"
        ? "Формирование юридического анализа…"
        : "Провести юридический анализ";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <header className="mb-10 text-center lg:text-left">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          Республика Казахстан
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          ZanKomek AI
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          Юридический AI-помощник по законодательству Республики Казахстан
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:gap-10">
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <div className="space-y-6">
            <div>
              <label
                htmlFor="legal-area"
                className="mb-2 block text-sm font-medium text-slate-800"
              >
                Область права
              </label>
              <select
                id="legal-area"
                value={legalArea}
                onChange={(event) => setLegalArea(event.target.value)}
                disabled={isLoading}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
              >
                {LEGAL_AREAS.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </div>

            <fieldset disabled={isLoading}>
              <legend className="mb-3 block text-sm font-medium text-slate-800">
                Тип пользователя
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {USER_TYPES.map((type) => (
                  <label
                    key={type.value}
                    className={`flex cursor-pointer items-center justify-center rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      userType === type.value
                        ? "border-blue-600 bg-blue-50 text-blue-900"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="user-type"
                      value={type.value}
                      checked={userType === type.value}
                      onChange={(event) => setUserType(event.target.value)}
                      className="sr-only"
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="description"
                className="mb-2 block text-sm font-medium text-slate-800"
              >
                Описание юридической ситуации
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={8}
                disabled={isLoading}
                placeholder="Опишите ситуацию: что произошло, когда, какие документы есть, какой результат вы хотите получить..."
                className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
              />
              <p className="mt-2 text-xs text-slate-500">
                Минимум {MIN_DESCRIPTION_LENGTH} символов. Чем подробнее описание,
                тем точнее анализ.
              </p>
            </div>

            <div>
              <label
                htmlFor="document"
                className="mb-2 block text-sm font-medium text-slate-800"
              >
                Документ для анализа (необязательно)
              </label>
              <input
                id="document"
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleDocumentFileChange}
                disabled={isLoading}
                className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-60"
              />
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Поддерживается только DOCX, максимальный размер — 1 МБ. Файл
                анализируется вместе с пояснением. Загруженный документ не
                является официальным источником закона.
              </p>
              {documentFile ? (
                <p className="mt-2 text-xs text-slate-600">
                  Выбран файл: {documentFile.name}
                </p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={isLoading}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm leading-relaxed text-slate-700">
                Я согласен(на) на обработку персональных данных в соответствии с
                законодательством Республики Казахстан
              </span>
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-xl bg-blue-700 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
            >
              {isLoading ? loadingLabel : "Провести юридический анализ"}
            </button>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
          </div>
        </form>

        <aside className="h-fit rounded-2xl border border-slate-200 bg-slate-900 p-6 text-white shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold">Что вы получите</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Структурированный правовой анализ на основе актуального
            законодательства РК
          </p>
          <ul className="mt-6 space-y-4">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3 text-sm">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-300"
                  aria-hidden
                >
                  ✓
                </span>
                <span className="text-slate-100">{benefit}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {result && (
        <div className="mt-8">
          <AnalysisResult result={result} />
        </div>
      )}

      <footer className="mt-10 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm leading-relaxed text-amber-900">
          <span className="font-semibold">Дисклеймер:</span> Сервис предоставляет
          информационный правовой анализ и не заменяет адвоката, нотариуса или
          представителя в суде.
        </p>
      </footer>
    </div>
  );
}
