import type { LearningRecord } from './record-types.js';

const EMBEDDING_DIMENSIONS = 256;

export interface LearningEmbedding {
  model: string;
  dimensions: number;
  vector: number[];
}

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

export function serializeVector(vector: number[]): string {
  return JSON.stringify(vector);
}

export function deserializeVector(serialized: string): number[] {
  const parsed = JSON.parse(serialized) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((value) => (typeof value === 'number' ? value : Number(value)))
    .filter((value) => Number.isFinite(value));
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9_]+/g) ?? [];
  const tokens = [...words];

  for (let index = 0; index < words.length - 1; index += 1) {
    tokens.push(`${words[index]}_${words[index + 1]}`);
  }

  return tokens;
}

function hashToken(token: string): number {
  let hash = 0;

  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) | 0;
  }

  return hash;
}

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
