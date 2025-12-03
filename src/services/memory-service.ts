import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { DatabaseManager } from '../database.js';
import { EmbeddingService } from './embedding-service.js';
import { OpenAIService } from './openai-service.js';

export interface CaptureMemoryParams {
  prNumber: number;
  commentAuthor: string;
  commentText: string;
  filePath: string | null;
  prDescription: string;
  repository: string;
}

export interface MemoryWithContext {
  id: string;
  commentText: string;
  filePath: string | null;
  prDescription: string;
  commentAuthor: string;
  relevantChunk: string;
  distance: number;
}

export class MemoryService {
  private dbManager: DatabaseManager;
  private embeddingService: EmbeddingService;

  constructor() {
    this.dbManager = new DatabaseManager();
    this.embeddingService = new EmbeddingService();
  }

  async captureMemory(params: CaptureMemoryParams): Promise<string> {
    try {
      // 1. Condense PR description if needed
      const condensed = await this.condensePRDescription(params.prDescription);

      // 2. Create memory item
      const memoryId = randomUUID();
      const db = this.dbManager.getKysely();

      await db
        .insertInto('memory_items')
        .values({
          id: memoryId,
          pr_number: params.prNumber,
          comment_author: params.commentAuthor,
          comment_text: params.commentText,
          file_path: params.filePath,
          pr_description: condensed,
          resolution_summary: null,
          repository: params.repository,
          created_at: new Date().toISOString()
        })
        .execute();

      // 3. Chunk and embed combined text
      const combinedText = `${condensed}\n\nComment: ${params.commentText}`;
      const chunks = await this.embeddingService.chunkAndEmbed(combinedText);

      // 4. Store embeddings
      for (let i = 0; i < chunks.length; i++) {
        await db
          .insertInto('memory_embeddings')
          .values({
            id: randomUUID(),
            memory_item_id: memoryId,
            chunk_text: chunks[i].text,
            chunk_index: i,
            embedding: JSON.stringify(chunks[i].embedding)
          })
          .execute();
      }

      return memoryId;
    } catch (error) {
      console.error('Error capturing memory:', error);
      throw error;
    }
  }

  async retrieveSimilarMemories(
    query: string,
    repository: string,
    limit: number = 3
  ): Promise<MemoryWithContext[]> {
    try {
      // Generate query embedding
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);

      // Search using cosine similarity
      const db = this.dbManager.getKysely();

      const results = await db
        .selectFrom('memory_embeddings as me')
        .innerJoin('memory_items as mi', 'mi.id', 'me.memory_item_id')
        .select([
          'mi.id',
          'mi.comment_text',
          'mi.file_path',
          'mi.pr_description',
          'mi.comment_author',
          'me.chunk_text',
          sql<number>`vec_distance_cosine(me.embedding, ${JSON.stringify(queryEmbedding)})`.as('distance')
        ])
        .where('mi.repository', '=', repository)
        .orderBy('distance', 'asc')
        .limit(limit)
        .execute();

      return results.map(r => ({
        id: r.id,
        commentText: r.comment_text,
        filePath: r.file_path,
        prDescription: r.pr_description,
        commentAuthor: r.comment_author,
        relevantChunk: r.chunk_text,
        distance: r.distance
      }));
    } catch (error) {
      console.error('Error retrieving similar memories:', error);
      // Return empty array on error - memory failures should not block execution
      return [];
    }
  }

  private async condensePRDescription(desc: string): Promise<string> {
    // If description is short enough, return as-is
    if (desc.length <= 500) {
      return desc;
    }

    try {
      const openaiService = new OpenAIService();
      const client = await openaiService.getClient();

      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Condense this PR description to 2-3 clear sentences that capture the main purpose and changes.'
          },
          {
            role: 'user',
            content: desc
          }
        ],
        temperature: 0.3,
        max_tokens: 150
      });

      const condensed = completion.choices[0]?.message?.content?.trim();
      return condensed || desc;
    } catch (error) {
      console.error('Failed to condense PR description, using original:', error);
      // If condensing fails, just truncate to 500 chars
      return desc.substring(0, 500) + '...';
    }
  }
}
