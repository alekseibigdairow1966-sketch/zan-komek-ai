import assert from "node:assert/strict";
import { test } from "node:test";
import { cosineSimilarity } from "./cosine-similarity";

const TOLERANCE = 1e-12;

function assertClose(actual: number, expected: number, tolerance = TOLERANCE) {
  assert.equal(
    Number.isFinite(actual),
    true,
    `Expected a finite number, received ${actual}`,
  );
  assert.equal(
    Math.abs(actual - expected) <= tolerance,
    true,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("cosineSimilarity returns 1 for identical vectors", () => {
  assertClose(cosineSimilarity([1, 0], [1, 0]), 1);
  assertClose(cosineSimilarity([0.5, -0.25, 2], [0.5, -0.25, 2]), 1);
});

test("cosineSimilarity returns 1 for vectors with the same direction", () => {
  assertClose(cosineSimilarity([1, 2, 3], [2, 4, 6]), 1);
});

test("cosineSimilarity returns 0 for orthogonal vectors", () => {
  assertClose(cosineSimilarity([1, 0], [0, 1]), 0);
  assertClose(cosineSimilarity([0, 3], [4, 0]), 0);
});

test("cosineSimilarity returns -1 for opposite vectors", () => {
  assertClose(cosineSimilarity([1, 0], [-1, 0]), -1);
  assertClose(cosineSimilarity([1, 2, 3], [-1, -2, -3]), -1);
});

test("cosineSimilarity returns 1 / sqrt(2) for a 45 degree pair", () => {
  assertClose(cosineSimilarity([1, 1], [1, 0]), 1 / Math.sqrt(2));
  assertClose(cosineSimilarity([1, 1], [1, 0]), Math.SQRT1_2);
});

test("cosineSimilarity is symmetric", () => {
  const left = [1, 2, 3];
  const right = [4, -5, 6];

  assertClose(cosineSimilarity(left, right), cosineSimilarity(right, left));
  assertClose(cosineSimilarity([1, 1], [1, 0]), cosineSimilarity([1, 0], [1, 1]));
});

test("cosineSimilarity handles negative components", () => {
  // dot = 1 * -1 + -2 * 2 = -5; norms = sqrt(5) * sqrt(5) = 5
  assertClose(cosineSimilarity([1, -2], [-1, 2]), -1);
  // dot = -1 * 1 + 1 * 1 = 0
  assertClose(cosineSimilarity([-1, 1], [1, 1]), 0);
});

test("cosineSimilarity handles vectors with more than two dimensions", () => {
  // dot = 4 + 10 + 18 = 32; norms = sqrt(14) * sqrt(77)
  const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));

  assertClose(cosineSimilarity([1, 2, 3], [4, 5, 6]), expected);
  assertClose(cosineSimilarity([1, 2, 3], [4, 5, 6]), 0.9746318461970762, 1e-12);
});

test("cosineSimilarity does not round the result", () => {
  const result = cosineSimilarity([1, 2, 3], [4, 5, 6]);

  assert.notEqual(result, Number(result.toFixed(4)));
  assert.notEqual(result, Number(result.toFixed(8)));
});

test("cosineSimilarity does not mutate the input vectors", () => {
  const left = [1, 2, 3];
  const right = [4, 5, 6];
  const leftSnapshot = [...left];
  const rightSnapshot = [...right];

  cosineSimilarity(left, right);

  assert.deepEqual(left, leftSnapshot);
  assert.deepEqual(right, rightSnapshot);
});

test("cosineSimilarity throws when vector lengths differ", () => {
  assert.throws(() => cosineSimilarity([1, 2, 3], [1, 2]), /mismatch/i);
  assert.throws(() => cosineSimilarity([1, 2], [1, 2, 3]), /mismatch/i);
  assert.throws(() => cosineSimilarity([1, 2, 3], [1, 2]), /3/);
  assert.throws(() => cosineSimilarity([1, 2, 3], [1, 2]), /2/);
});

test("cosineSimilarity throws for empty vectors", () => {
  assert.throws(() => cosineSimilarity([], []), /empty/i);
  assert.throws(() => cosineSimilarity([], [1, 0]), /(empty|mismatch)/i);
  assert.throws(() => cosineSimilarity([1, 0], []), /(empty|mismatch)/i);
});

test("cosineSimilarity throws for a zero vector on either side", () => {
  assert.throws(() => cosineSimilarity([0, 0], [1, 0]), /zero/i);
  assert.throws(() => cosineSimilarity([1, 0], [0, 0]), /zero/i);
  assert.throws(() => cosineSimilarity([0, 0, 0], [0, 0, 0]), /zero/i);
});

test("cosineSimilarity never returns NaN, Infinity or 0 for zero vectors", () => {
  const cases: Array<[number[], number[]]> = [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [1, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 0],
    ],
  ];

  for (const [left, right] of cases) {
    let result: number | undefined;
    let thrown: unknown;

    try {
      result = cosineSimilarity(left, right);
    } catch (error) {
      thrown = error;
    }

    assert.equal(thrown instanceof Error, true);
    assert.equal(result, undefined);
  }
});
