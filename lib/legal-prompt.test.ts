import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegalAnalysisPrompt } from "./legal-prompt";

test("legal prompt includes auxiliary handbook for personal data legal area without description keywords", () => {
  const prompt = buildLegalAnalysisPrompt(
    {
      legalArea: "Персональные данные",
      userType: "too",
      description:
        "Проверьте соответствие выбранной области права требованиям законодательства.",
      consent: true,
    },
    [],
  );

  assert.match(prompt, /ВСПОМОГАТЕЛЬНЫЙ РЕГЛАМЕНТ/);
  assert.match(prompt, /pd-regulation-handbook/);
  assert.match(prompt, /template-consent-form|Шаблон согласия на обработку персональных данных/);
});

test("legal prompt forbids partial confirmation without fully confirmed direct legal_act", () => {
  const prompt = buildLegalAnalysisPrompt(
    {
      legalArea: "Персональные данные",
      userType: "too",
      description: "Нужно проверить чекбоксы согласия на сайте.",
      consent: true,
    },
    [],
  );

  assert.match(
    prompt,
    /Не используй формулировки «подтверждено», «частично подтверждено», «подтверждено официальным источником»/,
  );
  assert.match(
    prompt,
    /source_type = "legal_act", relevance_status = "direct", content_checked = true, search_confirmed = true/,
  );
  assert.match(
    prompt,
    /общего закона о персональных данных не подтверждает автоматически.*обязательность отдельного UI-чекбокса/,
  );
  assert.match(
    prompt,
    /Явно разделяй: правовую необходимость получить согласие; способ технической фиксации согласия; обязательность конкретного элемента интерфейса/,
  );
});
