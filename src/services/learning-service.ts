import { DatabaseManager } from '../database.js';
import { OpenAIService } from './openai-service.js';
import { Selectable } from 'kysely';
import type { Learning as DbLearning } from '../database/types.js';
import chalk from 'chalk';

export interface OnboardingQuestion {
  question: string;
  context: string; // Additional context to help Claude answer better
}

export interface LearningSearchResult {
  learning_id: number;
  text: string;
  files: string;
  created_at: string;
  distance: number;
}

export interface Learning {
  question: string;
  answer: string;
  files: string[];
  repositoryId: number;
}

export class LearningService {
  private dbManager: DatabaseManager;
  private openaiService: OpenAIService;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    this.openaiService = new OpenAIService();
  }

  async saveLearning(learning: Learning): Promise<number> {
    console.log(chalk.blue('💾 Saving learning to database...'));

    const db = this.dbManager.getKysely();

    // Insert the learning
    const result = await db
      .insertInto('learnings')
      .values({
        repository_id: learning.repositoryId,
        text: `Q: ${learning.question}\n\nA: ${learning.answer}`,
        files: JSON.stringify(learning.files)
      })
      .executeTakeFirst();

    const learningId = Number(result.insertId);

    console.log(chalk.green(`✅ Learning saved with ID: ${learningId}`));

    // Generate and store embeddings
    await this.generateAndStoreEmbedding(
      learningId,
      learning.question,
      learning.answer
    );

    return learningId;
  }

  private async generateAndStoreEmbedding(
    learningId: number,
    question: string,
    answer: string
  ): Promise<void> {
    console.log(chalk.blue('🔮 Generating embeddings...'));

    try {
      const openai = await this.openaiService.getClient();

      // Combine question and answer for embedding
      const textToEmbed = `${question}\n\n${answer}`;

      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: textToEmbed,
        dimensions: 3072
      });

      const embedding = embeddingResponse.data[0].embedding;

      console.log(chalk.blue('💾 Storing embeddings...'));

      // Convert to Float32Array for sqlite-vec
      const embeddingArray = new Float32Array(embedding);

      // Use DatabaseManager's vector insert method
      this.dbManager.executeVectorInsert(embeddingArray.buffer, learningId, textToEmbed);

      console.log(chalk.green('✅ Embeddings stored successfully'));
    } catch (error) {
      console.error(chalk.red('❌ Failed to generate or store embeddings:'), error);
      throw error;
    }
  }

  async getRepositoryLearnings(repositoryId: number): Promise<Selectable<DbLearning>[]> {
    const db = this.dbManager.getKysely();

    const learnings = await db
      .selectFrom('learnings')
      .selectAll()
      .where('repository_id', '=', repositoryId)
      .orderBy('created_at', 'desc')
      .execute();

    return learnings;
  }

  async searchSimilarLearnings(
    repositoryId: number,
    queryText: string,
    limit: number = 5
  ): Promise<LearningSearchResult[]> {
    console.log(chalk.blue('🔍 Searching for similar learnings...'));

    try {
      const openai = await this.openaiService.getClient();

      // Generate embedding for the query
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: queryText,
        dimensions: 3072
      });

      const queryEmbedding = embeddingResponse.data[0].embedding;
      const embeddingArray = new Float32Array(queryEmbedding);

      // Use DatabaseManager's vector search method
      const results = this.dbManager.executeVectorSearch(
        embeddingArray.buffer,
        repositoryId,
        limit
      );

      console.log(chalk.green(`✅ Found ${results.length} similar learnings`));

      return results;
    } catch (error) {
      console.error(chalk.red('❌ Failed to search similar learnings:'), error);
      throw error;
    }
  }
}
