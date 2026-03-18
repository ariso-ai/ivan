// Semantic text embedding using OpenAI text-embedding-3-small.
// Requires OPENAI_API_KEY in the environment.
// Embeddings are cached in JSONL source files so the API is only called once per record.

import OpenAI from 'openai';
import type { LearningRecord } from './record-types.js';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Service wrapper for OpenAI embedding calls.
 * Holds the client as an instance field (following the codebase's class-based service pattern)
 * rather than a module-level singleton.
 */
export class EmbeddingsService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) this.client = new OpenAI();
    return this.client;
  }

  /**
   * Embeds a single text string. Used at query time to embed the search prompt.
   * Requires OPENAI_API_KEY.
   */
  async embedText(text: string): Promise<number[]> {
    const response = await this.getClient().embeddings.create({
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
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
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

// Module-level shared instance — used by builder.ts and query.ts which call the
// standalone embedText / embedTexts helpers below. Callers that need isolation
// (e.g. tests) can instantiate EmbeddingsService directly instead.
const _sharedService = new EmbeddingsService();

/** Embeds a single text string using the shared service instance. */
export function embedText(text: string): Promise<number[]> {
  return _sharedService.embedText(text);
}

/** Embeds multiple texts using the shared service instance. */
export function embedTexts(texts: string[]): Promise<number[][]> {
  return _sharedService.embedTexts(texts);
}
