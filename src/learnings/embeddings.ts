// Semantic text embedding using OpenAI text-embedding-3-small.
// Requires OPENAI_API_KEY in the environment.
// Embeddings are cached in JSONL source files so the API is only called once per record.

import OpenAI from 'openai';
import type { LearningRecord } from './record-types.js';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

/**
 * Returns the text string fed to the embedding model for a given learning.
 * Exported so callers can SHA-256 hash it for cache invalidation without calling the API.
 */
export function buildEmbeddingInputString(learning: LearningRecord): string {
  const textParts = [
    learning.kind,
    learning.title,
    learning.statement,
    learning.rationale,
    learning.applicability,
    learning.tags.join(' ')
  ].filter(Boolean);

  return textParts.join('\n');
}

/**
 * Embeds a single text string. Used at query time to embed the search prompt.
 * Requires OPENAI_API_KEY.
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });
  return response.data[0].embedding;
}

/**
 * Embeds multiple texts in a single API call. Used during rebuild to batch all
 * cache-missed learnings into one request.
 * Requires OPENAI_API_KEY.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
