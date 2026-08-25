import mammoth from "mammoth";

export const MAX_DOCUMENT_BYTES = 1_000_000;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface ExtractDocumentTextInput {
  data: ArrayBuffer;
  mimeType: string;
  fileName: string;
}

export interface ExtractDocumentTextResult {
  text: string;
  format: "docx";
  fileName: string;
  byteLength: number;
}

export type DocumentTextExtractionErrorCode =
  | "unsupported_format"
  | "file_too_large"
  | "empty_document"
  | "extraction_failed";

export class DocumentTextExtractionError extends Error {
  readonly code: DocumentTextExtractionErrorCode;
  readonly status: number;

  constructor(
    code: DocumentTextExtractionErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "DocumentTextExtractionError";
    this.code = code;
    this.status = status;
  }
}

function assertDocxFormat(fileName: string, mimeType: string): void {
  const normalizedName = fileName.trim().toLowerCase();
  const normalizedMime = mimeType.trim().toLowerCase();

  if (
    !normalizedName.endsWith(".docx") ||
    normalizedMime !== DOCX_MIME
  ) {
    throw new DocumentTextExtractionError(
      "unsupported_format",
      "Поддерживается только формат DOCX.",
      415,
    );
  }
}

function assertFileSize(byteLength: number): void {
  if (byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentTextExtractionError(
      "file_too_large",
      `Размер файла превышает допустимый лимит ${MAX_DOCUMENT_BYTES} байт.`,
      413,
    );
  }
}

export async function extractDocumentText(
  input: ExtractDocumentTextInput,
): Promise<ExtractDocumentTextResult> {
  assertDocxFormat(input.fileName, input.mimeType);

  const byteLength = input.data.byteLength;
  assertFileSize(byteLength);

  try {
    const buffer = Buffer.from(input.data);
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();

    if (!text) {
      throw new DocumentTextExtractionError(
        "empty_document",
        "Документ не содержит извлекаемого текста.",
        422,
      );
    }

    return {
      text,
      format: "docx",
      fileName: input.fileName.trim(),
      byteLength,
    };
  } catch (error) {
    if (error instanceof DocumentTextExtractionError) {
      throw error;
    }

    throw new DocumentTextExtractionError(
      "extraction_failed",
      "Не удалось извлечь текст из документа DOCX.",
      422,
    );
  }
}
