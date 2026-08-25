# PROJECT_STATE — ZanKomek AI

Дата фиксации: 12.07.2026 (конец сессии, после TLS/cross-env и ручного ретеста)

---

## 1. Цель проекта

**ZanKomek AI** — юридический AI-помощник по законодательству Республики Казахстан.

Основная задача: принимать описание правовой ситуации от пользователя (физлицо, ИП, ТОО), опционально — DOCX-документ, находить и проверять официальные источники, формировать структурированный правовой анализ с явным разделением:

- подтверждённых норм (direct-источники);
- связанных официальных материалов (related);
- практических рекомендаций и шаблонов;
- неподтверждённых утверждений.

Проект **не заменяет** адвоката и **не гарантирует** полное устранение юридических рисков.

---

## 2. Текущая архитектура

### Общий поток запроса

```
Форма (клиент)
  → POST /api/analyze
      JSON (без файла)  или  multipart/form-data (с DOCX)
    → resolveAnalysisRequest()        # JSON или multipart + extractDocumentText()
    → runLegalSourceSearch()          # core-акты + Tavily + релевантность
    → buildLegalAnalysisPrompt()      # официальные источники + вспомогательный регламент
    → callOpenAIResponses()           # OpenAI Responses API
    → parseAnalysisResult()
    → retrySearchForModelActs()       # повторный поиск по актам из ответа модели
    → enrichAnalysisWithSearch()      # подтверждение URL, бейджи, статусы, санитизация текста
  → AnalysisResult (клиент)
```

### Слои серверной логики

| Слой | Модули | Назначение |
|------|--------|------------|
| Поиск | `run-legal-source-search.ts`, `search-legal-sources.ts`, `build-legal-search-queries.ts` | Tavily по официальным доменам |
| Core-акты | `core-legal-acts.ts`, `build-core-legal-sources.ts` | Подтверждённые акты (ПДн), curated gov.kz |
| Релевантность | `evaluate-source-relevance.ts`, `fetch-official-source-content.ts`, `enrich-search-results.ts` | Загрузка HTML, оценка direct/related/irrelevant |
| Подтверждение | `confirm-sources-with-search.ts`, `verify-source-url.ts` | Бейджи, verified_by_search, привязка норм, санитизация unverified-текста |
| DOCX | `extract-document-text.ts` | Извлечение текста DOCX в памяти (mammoth) |
| Вспомогательный регламент | `auxiliary-provisions.ts` | Статический каталог положений регламента (не НПА) |
| AI | `openai-client.ts`, `legal-prompt.ts`, `parse-analysis-result.ts` | Промпт, вызов модели, парсинг JSON |
| UI | `legal-analysis-form.tsx`, `analysis-result.tsx` | Форма, результат, статус-баннеры, бейджи норм |

### Статусы ответа

| Статус | Условие |
|--------|---------|
| `official_sources_present` | Есть direct-источник `legal_act`, все нормы подтверждены |
| `partially_verified` | Есть direct, но не все ключевые нормы подтверждены |
| `unverified` | Нет direct-источников с `search_confirmed` + `content_checked` |

### Типы источников (`source_type`)

- `legal_act` — прямой нормативный акт
- `official_guidance` — официальное разъяснение (gov.kz)
- `official_authority` — страница госоргана
- `secondary_analysis` — Bluescreen, Servercore, Параграф (не официальные)

### Типы положений вспомогательного регламента (`provision_type`)

- `legal_requirement`, `subordinate_rule`, `practical_recommendation`, `document_template`, `technical_recommendation`, `secondary_analysis`, `unverified_claim`

---

## 3. Используемый стек

| Компонент | Версия / технология |
|-----------|---------------------|
| Framework | Next.js 16.2.10 (App Router) |
| UI | React 19.2.4, Tailwind CSS 4 |
| Язык | TypeScript 5 |
| AI | OpenAI SDK 6.x, Responses API (`gpt-5-mini` по умолчанию) |
| Поиск | Tavily API |
| DOCX | `mammoth` 1.12.0 (production) |
| Тесты DOCX-fixtures | `docx` 9.7.1 (devDependency) |
| Кросс-платформенный env | `cross-env` 10.1.0 (devDependency) |
| Тесты | Node.js test runner + `tsx` |
| Линтер | ESLint 9 + eslint-config-next |

### Переменные окружения (`.env.local`)

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
TAVILY_API_KEY=
```

Ключи только на сервере, без `NEXT_PUBLIC_*`.

### Запуск Node.js и TLS

Скрипты `dev`, `build`, `start` используют:

```
cross-env NODE_OPTIONS=--use-system-ca
```

Это подключает системное хранилище доверенных сертификатов Windows/macOS/Linux для Node.js `fetch` без отключения TLS-проверки.

**Запрещено:** `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, кастомный Agent без проверки сертификата.

---

## 4. Какие файлы были изменены / созданы

### Приложение (`app/`)

| Файл | Статус |
|------|--------|
| `app/page.tsx` | Лендинг юридического сервиса |
| `app/layout.tsx` | Layout |
| `app/globals.css` | Стили |
| `app/components/legal-analysis-form.tsx` | Форма: JSON или multipart с DOCX |
| `app/components/analysis-result.tsx` | Результат, бейджи, `resolveApplicableLawVerificationBadge()` |
| `app/components/analysis-result.test.ts` | 2 теста бейджа нормы (official + source_confirmed) |
| `app/api/analyze/route.ts` | API: JSON + multipart, `resolveAnalysisRequest()` экспортирована |
| `app/api/analyze/route.test.ts` | Тесты multipart-разбора (4 теста) |

### Библиотека (`lib/`)

| Файл | Назначение |
|------|------------|
| `types.ts` | Типы ответа, источников, статусов |
| `constants.ts` | Области права, типы пользователей |
| `openai-client.ts` | Вызов OpenAI Responses API |
| `openai-config.ts` | Конфигурация модели |
| `legal-prompt.ts` | Системный промпт с правилами достоверности (п. 21 — классификация свободного текста) |
| `legal-prompt.test.ts` | 2 теста промпта (регламент + запрет частичного подтверждения) |
| `parse-analysis-result.ts` | Парсинг JSON от модели |
| `parse-applicable-laws.ts` | Парсинг применимых норм |
| `extract-document-text.ts` | Извлечение текста DOCX в памяти |
| `extract-document-text.test.ts` | Валидация и успешное чтение DOCX (5 тестов) |
| `official-domains.ts` | Белый список официальных доменов |
| `verify-source-url.ts` | Проверка HTTPS и домена |
| `normalize-url.ts` | Нормализация URL для сравнения |
| `search-legal-sources.ts` | Интеграция Tavily |
| `build-legal-search-queries.ts` | Построение поисковых запросов |
| `extract-probable-act-names.ts` | Извлечение названий актов |
| `fetch-official-source-content.ts` | Загрузка HTML с официальных доменов (лимит текста 20 000 символов) |
| `evaluate-source-relevance.ts` | Оценка direct/related/irrelevant |
| `enrich-search-results.ts` | Обогащение результатов поиска |
| `run-legal-source-search.ts` | Оркестрация поиска + повторный поиск |
| `confirm-sources-with-search.ts` | Подтверждение источников, бейджи, `sanitizeUnverifiedConfirmationText()` |
| `confirm-sources-with-search.test.ts` | 9 тестов (включая 3 теста санитизации текста) |
| `core-legal-acts.ts` | Core-акты, `resolvePrimaryAct()` по legalArea + keywords |
| `build-core-legal-sources.ts` | Загрузка official_url до Tavily |
| `auxiliary-provisions.ts` | Вспомогательный регламент ПДн, классификатор (только тесты в runtime) |
| `legal-information-status.checks.ts` | Проверки статусов |

### Тесты (явный список в `npm test`)

- `lib/verify-source-url.test.ts`
- `lib/parse-applicable-laws.test.ts`
- `lib/confirm-sources-with-search.test.ts` (9 тестов)
- `lib/search-legal-sources.test.ts`
- `lib/evaluate-source-relevance.test.ts`
- `lib/fetch-official-source-content.test.ts`
- `lib/enrich-search-results.test.ts`
- `lib/core-legal-acts.test.ts` (8 тестов)
- `lib/auxiliary-provisions.test.ts`
- `lib/legal-prompt.test.ts` (2 теста)
- `lib/extract-document-text.test.ts` (5 тестов)
- `app/api/analyze/route.test.ts` (4 теста)
- `app/components/analysis-result.test.ts` (2 теста)
- `lib/legal-information-status.checks.ts`

**Итого автотестов: 79** (проверено `npm test` 12.07.2026).

### Прочее

| Файл | Статус |
|------|--------|
| `package.json` | `mammoth`, `docx`, `cross-env`, скрипты `dev`/`build`/`start` с `--use-system-ca` |
| `package-lock.json` | lockfile с `cross-env@10.1.0` |
| `.env.local.example` | Пример env |
| `AGENTS.md` / `CLAUDE.md` | Правила Next.js 16 |

---

## 5. Что уже работает

- [x] Лендинг и форма юридического анализа (область права, тип пользователя, описание, согласие)
- [x] Необязательная загрузка DOCX в форме (клиентская проверка расширения, MIME, 1 МБ)
- [x] POST `/api/analyze`: `application/json` (без файла) и `multipart/form-data` (с DOCX)
- [x] Извлечение текста DOCX через `extractDocumentText()` (mammoth, только в памяти)
- [x] Добавление извлечённого текста в `description` с заголовком `ТЕКСТ ЗАГРУЖЕННОГО ДОКУМЕНТА:`
- [x] Для multipart: короткое или пустое `description` допустимо; для JSON — минимум 20 символов
- [x] `resolvePrimaryAct()` учитывает `legalArea` (после `normalizeKeyword()`) **или** keywords в описании
- [x] Вспомогательный регламент в промпте при области «Персональные данные» даже без keywords
- [x] OpenAI Responses API — структурированный JSON-ответ
- [x] Поиск официальных источников через Tavily (только разрешённые домены)
- [x] Загрузка known URL основного закона ПДн **до** Tavily через `buildCoreLegalSources()`
- [x] При `NODE_OPTIONS=--use-system-ca` — успешная загрузка Adilet, `content_checked: true` для core-акта
- [x] Оценка релевантности: direct / related / irrelevant
- [x] Подтверждение источников и `source_confirmed` для ApplicableLaw по полным критериям
- [x] Санитизация «подтверждено официальным источником» при `legal_information_status === "unverified"`
- [x] Промпт: запрет «подтверждено» / «частично подтверждено» без полного direct `legal_act`
- [x] UI: синий «Официальный домен» на норме при `official` без `source_confirmed`
- [x] Вспомогательный регламент ПДн (18 записей в `AUXILIARY_PROVISIONS`)
- [x] UI-предупреждение для неподтверждённых подзаконных положений
- [x] `npm test` (79), `npx tsc --noEmit`, `npm run lint`, `npm run build` — проходят

---

## 6. Какие ошибки исправлены

| Проблема | Решение |
|----------|---------|
| `[object Object]` в «Применимые нормы» | `parse-applicable-laws.ts`, тип `ApplicableLaw` |
| Tavily находил amendment вместо прямого закона | Слой релевантности + amendment-паттерн → related |
| `resolvePrimaryAct()` игнорировал выбранную область права | Проверка `legalArea` против `act.legal_area` + keywords |
| `npm test` не включал новые тестовые файлы | Явный список в `package.json` |
| Подзаконные нормы подтверждались URL основного закона | `practical_recommendation` + `provisionConfirmsNorm()` |
| `source_confirmed` только по `relevance_status=direct` | `linkApplicableLawsToSources()` использует `confirmsLegalNorm()` + `search_confirmed` |
| Противоречивые бейджи на карточке нормы | `resolveApplicableLawVerificationBadge()` в `analysis-result.tsx` |
| Ложное «подтверждено официальным источником» при `unverified` | `sanitizeUnverifiedConfirmationText()` в `enrichAnalysisWithSearch()` |
| «Частично подтверждено» для UI-чекбоксов без direct-источника | Пункт 21 в `legal-prompt.ts` |
| Core-акт Adilet не подтверждался (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) | `cross-env NODE_OPTIONS=--use-system-ca` в `dev`/`build`/`start` |
| Зелёный «Официальный источник» при `source_confirmed: false` | Локальный бейдж «Официальный домен» (синий) в `ApplicableLawItem` |

---

## 7. Принятые решения

### 7.1. Два формата запроса API
- **JSON** — без файла, прежняя логика.
- **multipart** — поля `legalArea`, `userType`, `description`, `consent`, `document` (File DOCX).

### 7.2. DOCX только на сервере Node.js
- `mammoth.extractRawText({ buffer })`, лимит 1 000 000 байт.
- PDF **не поддерживается**; OCR не используется.
- Файл **не сохраняется** на диск.
- Поддерживается только DOCX; JSON-сценарий без файла сохранён.

### 7.3. `resolvePrimaryAct()` — два триггера
1. Точное совпадение `request.legalArea` с одним из `act.legal_area` (после `normalizeKeyword()`).
2. Keywords в `description` через `matchesActKeywords()`.

### 7.4. `source_confirmed` для ApplicableLaw
`true` только при:
- `source_type === "legal_act"`;
- `relevance_status === "direct"`;
- `content_checked === true`;
- `search_confirmed === true`.

### 7.5. Санитизация свободного текста при `unverified`
- Helper: `sanitizeUnverifiedConfirmationText(text, status)` в `confirm-sources-with-search.ts`.
- При `status === "unverified"` заменяет «подтверждено официальным источником» (без учёта регистра) на «не подтверждено найденным официальным источником и требует ручной проверки».
- Применяется в `enrichAnalysisWithSearch()` к: `legalAssessment`, `analysis`, `riskAnalysis`, каждому элементу `recommendedActions`.
- При `partially_verified` и `official_sources_present` текст **не меняется**.

### 7.6. Промпт: классификация утверждений в свободном тексте
Пункт 21 в `legal-prompt.ts`:
- Запрет «подтверждено», «частично подтверждено», «подтверждено официальным источником» без полного direct `legal_act` (`content_checked` + `search_confirmed`).
- Общий Закон о ПДн не подтверждает автоматически: UI-чекбокс, блокировку кнопки, cookies-баннер, журнал согласий, чекбокс трансграничной передачи, техническую реализацию согласия.
- Разделение: правовая необходимость согласия / способ фиксации / обязательность UI-элемента.

### 7.7. Бейдж ApplicableLaw при `official` без `source_confirmed`
- `resolveApplicableLawVerificationBadge()` в `analysis-result.tsx`.
- `official` + `source_confirmed !== true` → синий «Официальный домен».
- `official` + `source_confirmed === true` → зелёный «Официальный источник».
- Глобальные `VERIFICATION_STATUS_LABELS` и `VERIFICATION_BADGE_STYLES` не менялись.

### 7.8. TLS и загрузка Adilet
- Core URL: `https://adilet.zan.kz/rus/docs/Z1300000094` (вариант `/info` в core **не используется**).
- Без `--use-system-ca`: Node.js `fetch` → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; `buildCoreLegalSourceResult()` → `null`.
- С `--use-system-ca`: HTTP 200, HTML > 120 000 символов; `fetchOfficialSourceContent()` → `content_checked: true`, `text` обрезается до 20 000 символов; core → `legal_act`, `direct`, `search_confirmed: true`.
- `curl.exe` получает HTTP 200 независимо от Node-флагов.
- Отключение TLS **не применялось** и запрещено.

### 7.9. cross-env и скрипты запуска
- `cross-env@10.1.0` (devDependency).
- Изменены только: `dev`, `build`, `start`.
- `test` и `lint` без изменений.

### 7.10. Прочие решения
Сохранены: прямой OpenAI, Tavily по официальным доменам, три уровня релевантности, core-акты, вспомогательный регламент не НПА, подзаконные URL отдельно, secondary blocked, КДП не обязателен для частного сайта, дисклеймер рисков.

---

## 8. Результат ручного функционального теста

Документ: **«Анализ документа и использование шаблона.docx»** (повторный тест после `NODE_OPTIONS=--use-system-ca`).

### Успешно

- DOCX загружен и прочитан; текст добавлен в `description`.
- Основной Закон РК «О персональных данных и их защите» получает полное серверное подтверждение:
  - `source_type = "legal_act"`;
  - `relevance_status = "direct"`;
  - `content_checked = true`;
  - `search_confirmed = true`;
  - `source_confirmed = true`.
- В UI: зелёный «Официальный источник», зелёный «Прямой официальный источник», рабочий URL Adilet.
- `legal_information_status` изменился с `unverified` на **`partially_verified`**.
- Верхний баннер: «Часть правовых выводов подтверждена прямыми официальными источниками. Остальные положения требуют проверки».

### По-прежнему корректно не подтверждается автоматически

- Подзаконные положения основным законом: уведомление за один рабочий день; базы > 100 000 записей; правила уведомления; технические требования защиты.
- Шаблонные положения не выдаются за обязательный закон: чекбоксы; блокировка кнопки; cookies; журнал согласий; AES-256; TLS 1.3; NDA; запрет парсинга.

### Итог ручного теста

Результат признан **успешным по основной задаче юридической достоверности**: основной закон подтверждён сервером; шаблонные и подзаконные утверждения не маскируются под прямую норму.

### Ранее зафиксированная проблема (устранена в этой сессии)

- Ложное «подтверждено официальным источником» при `unverified` → санитизация + промпт.
- Противоречивый зелёный бейдж «Официальный источник» при «Не подтверждено» → `resolveApplicableLawVerificationBadge()`.
- Core-акт не загружался из-за TLS → `--use-system-ca`.

---

## 9. Какие задачи остались

### Высокий приоритет

1. [ ] Найти прямые официальные URL подзаконных актов для:
   - уведомления об инциденте;
   - баз более 100 000 записей;
   - правил сбора и обработки ПДн;
   - требований по защите ПДн.
2. [ ] Проверить возможность извлечения и сопоставления конкретных статей из подтверждённого текста Adilet.
3. [ ] Устранить оставшуюся асимметрию: `ApplicableLaw.source_url` может показываться при `direct` без `content_checked`, тогда как `LegalSource` скрывает URL без полного подтверждения (`getBestDirectSourceForAct()` не требует `content_checked`).
4. [ ] Проверить поведение production-среды: поддерживает ли хостинг `NODE_OPTIONS=--use-system-ca`.

### Средний приоритет

- [ ] Структурированная классификация утверждений документа вместо свободного текста.
- [ ] Отображение количества извлечённых символов DOCX и признака возможного обрезания.
- [ ] Расширение core-актов на другие области права.
- [ ] E2E-тест с реальным Tavily.
- [ ] UI: маркировка `provision_type` в «Перечень документов».
- [ ] `.gitignore` для `.next/`.

### Низкий приоритет

- [ ] PDF — **не начинать** до отдельного решения.
- [ ] CI/CD (GitHub Actions).
- [ ] Деплой.

---

## 10. Точный следующий шаг

**Провести аудит извлечённого текста основного Закона с Adilet и определить, можно ли безопасно сопоставлять конкретные статьи с утверждениями без ложного подтверждения.**

Новый агент должен **сначала ничего не менять** и проверить по коду и живому fetch (с `--use-system-ca`):

- содержимое `fetched.text` для core-акта;
- структуру HTML Adilet;
- наличие номеров и заголовков статей;
- текущий лимит обрезания текста (20 000 символов в `fetch-official-source-content.ts`);
- возможность детерминированного парсера статей;
- риски сопоставления статьи по ключевым словам.

---

## 11. Важные ограничения (нельзя нарушать)

### Интеграции

- **Не менять** OpenAI (`openai-client.ts`, Responses API) без явного запроса.
- **Не менять** Tavily без явного запроса.
- API-ключи **только на сервере**, никогда `NEXT_PUBLIC_*`.

### TLS и загрузка официальных источников

- **Не отключать** TLS-проверку.
- **Не использовать** `rejectUnauthorized: false`.
- **Не использовать** `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **Не добавлять** кастомный Agent без проверки сертификата для Adilet.
- Допустимо: `NODE_OPTIONS=--use-system-ca` (системное хранилище CA).
- При недоступности system CA на хостинге — безопасно подключить недостающий intermediate/root через `NODE_EXTRA_CA_CERTS`.

### Достоверность

- **Не считать** источник подтверждённым без `direct` + `content_checked` + `search_confirmed` + `legal_act`.
- **Не использовать** URL основного закона для подзаконных норм.
- **Не добавлять** Bluescreen, Servercore, Параграф в белый список.
- **Не выдавать** шаблоны и рекомендации регламента как прямую норму закона.
- Загруженный DOCX — **не официальный источник закона**.

### Технические

- Next.js 16 — читать `node_modules/next/dist/docs/` перед изменениями API.
- Работать **по одному изменению**; после каждого — точечный тест, `tsc`, `npm test`, при необходимости `lint`/`build`.
- **Не считать** этот файл доказательством реализации — сверять с кодом.

### Правовые

- Сервис **не является** юридической консультацией.
- Модель может ошибаться; сервер задаёт правила, но не гарантирует содержание ответа на 100%.

---

## Приложение: официальные домены

```
adilet.zan.kz
zan.gov.kz
gov.kz
sud.gov.kz
office.sud.kz
kgd.gov.kz
nationalbank.kz
```

## Приложение: заблокированные домены (secondary_analysis)

```
bluescreen.kz
servercore.com
prg.kz
```

## Приложение: core-акт ПДн

| Поле | Значение |
|------|----------|
| id | `personal-data-law-kz` |
| URL | `https://adilet.zan.kz/rus/docs/Z1300000094` |
| Области | Персональные данные, Цифровое право, Предпринимательское право |

Путь core-акта в коде:

```
CORE_LEGAL_ACTS
  → buildCoreLegalSources()
    → fetchOfficialSourceContent(official_url)
    → actContentMatchesAct()
  → runLegalSourceSearch() (merge + enrichSearchResultsWithRelevance)
  → enrichAnalysisWithSearch()
```

## Приложение: команды разработки

```bash
npm run dev          # cross-env NODE_OPTIONS=--use-system-ca next dev
npm run lint         # ESLint
npx tsc --noEmit     # проверка типов
npm test             # 79 тестов + status checks
npm run build        # cross-env NODE_OPTIONS=--use-system-ca next build
```

Проверено 12.07.2026: `npm test` → 79 passed; `Legal information status checks passed`; `npx tsc --noEmit` → ok; `npm run lint` → ok; `npm run build` → ok.

## Приложение: зависимости DOCX

| Пакет | Версия | Назначение |
|-------|--------|------------|
| `mammoth` | 1.12.0 | Production: чтение DOCX на сервере |
| `docx` | 9.7.1 | Dev: программное создание DOCX в тестах |

## Приложение: зависимости окружения

| Пакет | Версия | Назначение |
|-------|--------|------------|
| `cross-env` | 10.1.0 | `NODE_OPTIONS=--use-system-ca` в `dev`/`build`/`start` на Windows/macOS/Linux |
