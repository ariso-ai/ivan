import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIService } from './openai-service.js';

export interface ChunkWithEmbedding {
  text: string;
  embedding: number[];
}

export class EmbeddingService {
  private openaiService: OpenAIService;
  private splitter: RecursiveCharacterTextSplitter;

  constructor() {
    this.openaiService = new OpenAIService();
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const client = await this.openaiService.getClient();

    try {
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  async chunkAndEmbed(text: string): Promise<ChunkWithEmbedding[]> {
    // Split text into chunks
    const chunks = await this.splitter.splitText(text);

    if (chunks.length === 0) {
      // If no chunks, treat entire text as a single chunk
      const embedding = await this.generateEmbedding(text);
      return [{ text, embedding }];
    }

    // Generate embeddings for each chunk
    const results: ChunkWithEmbedding[] = [];

    for (const chunk of chunks) {
      try {
        const embedding = await this.generateEmbedding(chunk);
        results.push({ text: chunk, embedding });
      } catch (error) {
        console.error('Failed to embed chunk:', error);
        // Continue with other chunks
      }
    }

    return results;
  }
}
