import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, Packer, Paragraph } from "docx";
import { NextResponse } from "next/server";
import { resolveAnalysisRequest } from "./route";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DESCRIPTION =
  "Проведите юридический анализ загруженного документа.";

const DOCUMENT_TEXT = "Это текст загруженного юридического документа.";

async function createDocxFile(text: string): Promise<File> {
  const document = new Document({
    sections: [
      {
        children: [new Paragraph(text)],
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);

  return new File(
    [
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    ],
    "legal-document.docx",
    { type: DOCX_MIME },
  );
}

function createMultipartRequest(formData: FormData): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    body: formData,
  });
}

function createBaseFormData(): FormData {
  const formData = new FormData();
  formData.set("legalArea", "Персональные данные");
  formData.set("userType", "too");
  formData.set("description", DESCRIPTION);
  formData.set("consent", "true");
  return formData;
}

test("multipart request with docx combines uploaded document text into description", async () => {
  const formData = createBaseFormData();
  formData.set("document", await createDocxFile(DOCUMENT_TEXT));

  const result = await resolveAnalysisRequest(createMultipartRequest(formData));

  if (result instanceof NextResponse) {
    assert.fail("expected AnalysisRequest");
  }

  assert.equal(result.legalArea, "Персональные данные");
  assert.equal(result.userType, "too");
  assert.equal(result.consent, true);
  assert.ok(result.description.includes(DESCRIPTION));
  assert.ok(result.description.includes("ТЕКСТ ЗАГРУЖЕННОГО ДОКУМЕНТА:"));
  assert.ok(result.description.includes(DOCUMENT_TEXT));
});

test("multipart request without document returns 400", async () => {
  const result = await resolveAnalysisRequest(
    createMultipartRequest(createBaseFormData()),
  );

  assert.ok(result instanceof NextResponse);
  assert.equal(result.status, 400);

  const body = (await result.json()) as { error?: string };
  assert.equal(body.error, "Поле document должно содержать файл DOCX");
});

test("multipart request accepts short description when docx is uploaded", async () => {
  const formData = createBaseFormData();
  formData.set("description", "Проверьте документ");
  formData.set("document", await createDocxFile(DOCUMENT_TEXT));

  const result = await resolveAnalysisRequest(createMultipartRequest(formData));

  if (result instanceof NextResponse) {
    assert.fail("expected AnalysisRequest");
  }

  assert.ok(result.description.includes("Проверьте документ"));
  assert.ok(result.description.includes("ТЕКСТ ЗАГРУЖЕННОГО ДОКУМЕНТА:"));
  assert.ok(result.description.includes(DOCUMENT_TEXT));
});

test("multipart request with empty description starts with uploaded document header", async () => {
  const formData = createBaseFormData();
  formData.set("description", "");
  formData.set("document", await createDocxFile(DOCUMENT_TEXT));

  const result = await resolveAnalysisRequest(createMultipartRequest(formData));

  if (result instanceof NextResponse) {
    assert.fail("expected AnalysisRequest");
  }

  assert.ok(result.description.startsWith("ТЕКСТ ЗАГРУЖЕННОГО ДОКУМЕНТА:"));
  assert.ok(result.description.includes(DOCUMENT_TEXT));
  assert.doesNotMatch(result.description, /^\s*\n\n/);
});
