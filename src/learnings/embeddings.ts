// Local, dependency-free text embedding used for semantic similarity search.
// Uses a hashed-feature bag-of-words approach (unigrams + bigrams → 256-dim L2-normalized vector).
// No external model or network call is required; the trade-off is lower recall than a real embedding model.

import type { LearningRecord } from './record-types.js';

/** Output dimensionality of the local embedding model. */
const EMBEDDING_DIMENSIONS = 256;

/** A vector representation of a learning's text content. */
export interface LearningEmbedding {
  /** Identifier for the embedding algorithm (`local-hashed-v1`). */
  model: string;
  dimensions: number;
  /** L2-normalized float array of length `dimensions`. */
  vector: number[];
}

/**
 * Produces a 256-dim embedding for a learning by concatenating its kind, title,
 * statement, rationale, applicability, and tags into a single text block.
 */
export function buildLearningEmbedding(
  learning: LearningRecord
): LearningEmbedding {
  const textParts = [
    learning.kind,
    learning.title,
    learning.statement,
    learning.rationale,
    learning.applicability,
    learning.tags.join(' ')
  ].filter(Boolean);

  return {
    model: 'local-hashed-v1',
    dimensions: EMBEDDING_DIMENSIONS,
    vector: embedText(textParts.join('\n'))
  };
}

/**
 * Converts raw text to a 256-dim L2-normalized vector using feature hashing.
 * Each token (unigram or bigram) is hashed to a bucket and incremented with ±1
 * depending on hash parity, then the whole vector is L2-normalized.
 */
export function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = Math.abs(hash) % EMBEDDING_DIMENSIONS;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  return normalize(vector);
}

/** Returns the cosine similarity (0–1) between two embedding vectors. Returns 0 if either is a zero vector. */
export function cosineSimilarity(left: number[], right: number[]): number {
  const size = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < size; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

/** Serializes a float vector to a JSON string for storage in SQLite's `vector_json` column. */
export function serializeVector(vector: number[]): string {
  return JSON.stringify(vector);
}

/** Deserializes a JSON string back to a float array, filtering out any non-finite values. */
export function deserializeVector(serialized: string): number[] {
  const parsed = JSON.parse(serialized) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((value) => (typeof value === 'number' ? value : Number(value)))
    .filter((value) => Number.isFinite(value));
}

/** Extracts lowercase alphanumeric words plus adjacent bigrams (`word_nextword`) from text. */
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9_]+/g) ?? [];
  const tokens = [...words];

  for (let index = 0; index < words.length - 1; index += 1) {
    tokens.push(`${words[index]}_${words[index + 1]}`);
  }

  return tokens;
}

/** Polynomial (base-31) string hash returning a signed 32-bit integer via bitwise OR truncation. */
function hashToken(token: string): number {
  let hash = 0;

  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) | 0;
  }

  return hash;
}

/** L2-normalizes a vector in-place (divides each component by the vector's magnitude). Returns the input unchanged if magnitude is zero. */
function normalize(vector: number[]): number[] {
  let magnitude = 0;

  for (const value of vector) {
    magnitude += value * value;
  }

  if (magnitude === 0) {
    return vector;
  }

  const divisor = Math.sqrt(magnitude);
  return vector.map((value) => value / divisor);
}
