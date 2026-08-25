import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { runOpenAiLegalEmbeddingBuild } from "../lib/run-openai-legal-embedding-build";

/**
 * Manual offline build of the legal embedding artifact.
 *
 * Usage:
 *   npm run build:legal-embeddings -- --corpus <corpus.jsonl> --output <artifact.json>
 *
 * Everything below the entry point is production code: parsing, cl100k_base
 * token counting, splitting, batching, the embeddings request and the artifact
 * are all owned by runOpenAiLegalEmbeddingBuild. This file only reads the
 * arguments, builds the OpenAI client and prints the result.
 */

interface CliOptions {
  corpus: string;
  output: string;
  artifactVersion: string;
  corpusVersion: string;
}

const USAGE =
  "Usage: npm run build:legal-embeddings -- --corpus <corpus.jsonl> --output <artifact.json> [--artifact-version <v>] [--corpus-version <v>]";

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Флаг ${flag} требует значение.\n${USAGE}`);
  }

  return value;
}

function parseOptions(argv: string[], createdAt: string): CliOptions {
  const corpus = readFlag(argv, "--corpus");
  const output = readFlag(argv, "--output");

  if (!corpus || !output) {
    throw new Error(`Не указаны --corpus и/или --output.\n${USAGE}`);
  }

  return {
    corpus,
    output,
    artifactVersion: readFlag(argv, "--artifact-version") ?? "1",
    corpusVersion: readFlag(argv, "--corpus-version") ?? createdAt.slice(0, 10),
  };
}

function readApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Не задан OPENAI_API_KEY. Передайте ключ через переменную окружения перед запуском; значение ключа нигде не выводится.",
    );
  }

  return apiKey;
}

async function main(): Promise<void> {
  const createdAt = new Date().toISOString();
  const options = parseOptions(process.argv.slice(2), createdAt);

  // Ключ проверяется до чтения корпуса и до создания клиента: без него запрос
  // не отправляется вообще.
  const client = new OpenAI({ apiKey: readApiKey() });
  const corpusJsonl = await readFile(options.corpus, "utf8");

  const result = await runOpenAiLegalEmbeddingBuild(
    {
      corpusJsonl,
      outputPath: options.output,
      artifactVersion: options.artifactVersion,
      corpusVersion: options.corpusVersion,
      createdAt,
    },
    client,
  );

  console.log(`outputPath: ${result.outputPath}`);
  console.log(`recordCount: ${result.recordCount}`);
  console.log(`artifactVersion: ${result.artifactVersion}`);
  console.log(`corpusVersion: ${result.corpusVersion}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
