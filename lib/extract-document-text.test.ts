import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, Packer, Paragraph } from "docx";
import {
  DocumentTextExtractionError,
  MAX_DOCUMENT_BYTES,
  extractDocumentText,
} from "./extract-document-text";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function expectDocumentTextExtractionError(
  promise: Promise<unknown>,
  expected: { code: DocumentTextExtractionError["code"]; status: number },
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DocumentTextExtractionError);
    assert.equal(error.code, expected.code);
    assert.equal(error.status, expected.status);
    return true;
  });
}

test("rejects unsupported file extension", async () => {
  await expectDocumentTextExtractionError(
    extractDocumentText({
      fileName: "document.pdf",
      mimeType: DOCX_MIME,
      data: new ArrayBuffer(0),
    }),
    { code: "unsupported_format", status: 415 },
  );
});

test("rejects unsupported mime type", async () => {
  await expectDocumentTextExtractionError(
    extractDocumentText({
      fileName: "document.docx",
      mimeType: "application/pdf",
      data: new ArrayBuffer(0),
    }),
    { code: "unsupported_format", status: 415 },
  );
});

test("rejects file larger than max document bytes", async () => {
  await expectDocumentTextExtractionError(
    extractDocumentText({
      fileName: "document.docx",
      mimeType: DOCX_MIME,
      data: new ArrayBuffer(MAX_DOCUMENT_BYTES + 1),
    }),
    { code: "file_too_large", status: 413 },
  );
});

test("rejects corrupted docx payload", async () => {
  await expectDocumentTextExtractionError(
    extractDocumentText({
      fileName: "document.docx",
      mimeType: DOCX_MIME,
      data: new TextEncoder().encode("not a valid docx").buffer,
    }),
    { code: "extraction_failed", status: 422 },
  );
});

test("extracts text from a valid docx", async () => {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph("Согласие на обработку персональных данных"),
          new Paragraph("Пользователь вправе отозвать согласие."),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);

  const result = await extractDocumentText({
    fileName: "consent.docx",
    mimeType: DOCX_MIME,
    data: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  });

  assert.equal(result.format, "docx");
  assert.equal(result.fileName, "consent.docx");
  assert.equal(result.byteLength, buffer.byteLength);
  assert.ok(result.text.includes("Согласие на обработку персональных данных"));
  assert.ok(result.text.includes("Пользователь вправе отозвать согласие."));
  assert.ok(result.text.length > 0);
});
