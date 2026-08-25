import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseApplicableLaws,
  resolveApplicableLawArticle,
} from "./parse-applicable-laws";

test("parses array of strings", () => {
  const result = parseApplicableLaws([
    "Гражданский кодекс РК",
    " Закон о защите прав потребителей ",
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { act_name: "Гражданский кодекс РК" });
  assert.deepEqual(result[1], {
    act_name: "Закон о защите прав потребителей",
  });
});

test("parses array of objects", () => {
  const result = parseApplicableLaws([
    {
      act_name: "Трудовой кодекс РК",
      article: "ст. 52",
      provision: "Основания расторжения трудового договора",
      explanation: "Применимо при увольнении работника",
      verification_status: "unverified",
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.act_name, "Трудовой кодекс РК");
  assert.equal(result[0]?.article, "ст. 52");
  assert.equal(result[0]?.verification_status, "unverified");
});

test("parses empty array", () => {
  assert.deepEqual(parseApplicableLaws([]), []);
});

test("parses null as empty array", () => {
  assert.deepEqual(parseApplicableLaws(null), []);
});

test("skips object without act_name", () => {
  const result = parseApplicableLaws([
    { article: "ст. 10" },
    {},
    null,
  ]);

  assert.deepEqual(result, []);
});

test("parses mixed array", () => {
  const result = parseApplicableLaws([
    "Налоговый кодекс РК",
    {
      act_name: "Кодекс РК «О таможенном регулировании»",
      provision: "Порядок декларирования",
    },
    123,
    [["Вложенный закон"]],
    { name: "Закон об адвокатской деятельности" },
  ]);

  assert.equal(result.length, 5);
  assert.equal(result[0]?.act_name, "Налоговый кодекс РК");
  assert.equal(result[1]?.act_name, "Кодекс РК «О таможенном регулировании»");
  assert.equal(result[2]?.act_name, "123");
  assert.equal(result[3]?.act_name, "Вложенный закон");
  assert.equal(result[4]?.act_name, "Закон об адвокатской деятельности");
});

test("resolveApplicableLawArticle shows placeholder when article is missing", () => {
  assert.equal(
    resolveApplicableLawArticle({ act_name: "ГК РК" }),
    "Точная статья требует проверки в официальной базе",
  );
});

test("resolveApplicableLawArticle keeps confirmed article", () => {
  assert.equal(
    resolveApplicableLawArticle({
      act_name: "ГК РК",
      article: "ст. 272",
      verification_status: "official",
    }),
    "ст. 272",
  );
});

test("resolveApplicableLawArticle hides article line for official without article", () => {
  assert.equal(
    resolveApplicableLawArticle({
      act_name: "ГК РК",
      verification_status: "official",
    }),
    null,
  );
});
