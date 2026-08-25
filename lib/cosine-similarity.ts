export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error(
      `Vector dimension mismatch: ${left.length} !== ${right.length}`,
    );
  }

  if (left.length === 0) {
    throw new Error("Cannot compute cosine similarity for empty vectors");
  }

  let dot = 0;
  let leftNormSquared = 0;
  let rightNormSquared = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    dot += leftValue * rightValue;
    leftNormSquared += leftValue * leftValue;
    rightNormSquared += rightValue * rightValue;
  }

  if (leftNormSquared === 0 || rightNormSquared === 0) {
    throw new Error("Cannot compute cosine similarity with zero vector");
  }

  return dot / (Math.sqrt(leftNormSquared) * Math.sqrt(rightNormSquared));
}
