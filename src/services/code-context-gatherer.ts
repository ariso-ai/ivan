import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

export class CodeContextGatherer {
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async gatherContext(questions: string[], maxTokens: number = 32000): Promise<string> {
    const keywords = this.extractKeywords(questions);

    if (keywords.length === 0) {
      return this.getFileTree();
    }

    const matchingFiles = this.searchFiles(keywords);

    if (matchingFiles.length === 0) {
      return this.getFileTree();
    }

    let context = '';
    let estimatedTokens = 0;

    for (const filePath of matchingFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const fileTokens = this.estimateTokens(content);

        if (estimatedTokens + fileTokens > maxTokens) {
          // Add truncated version if we have room for at least some of it
          const remainingTokens = maxTokens - estimatedTokens;
          if (remainingTokens > 500) {
            const truncatedContent = content.substring(0, remainingTokens * 4);
            const relativePath = relative(this.workingDir, filePath);
            context += `\n--- ${relativePath} (truncated) ---\n${truncatedContent}\n`;
          }
          break;
        }

        const relativePath = relative(this.workingDir, filePath);
        context += `\n--- ${relativePath} ---\n${content}\n`;
        estimatedTokens += fileTokens;
      } catch {
        // Skip files that can't be read
      }
    }

    return context || this.getFileTree();
  }

  private extractKeywords(questions: string[]): string[] {
    const text = questions.join(' ');
    const keywords: string[] = [];

    // Extract quoted strings
    const quotedMatches = text.match(/"([^"]+)"|'([^']+)'/g);
    if (quotedMatches) {
      keywords.push(...quotedMatches.map(m => m.replace(/['"]/g, '')));
    }

    // Extract file paths (*.ts, *.js, etc.)
    const filePathMatches = text.match(/[\w/-]+\.\w{1,4}/g);
    if (filePathMatches) {
      keywords.push(...filePathMatches);
    }

    // Extract function/method names (camelCase or snake_case with parens)
    const funcMatches = text.match(/[a-zA-Z_]\w+(?:\(\))?/g);
    if (funcMatches) {
      // Filter to likely code identifiers (camelCase, contains underscore, or has parens)
      const codeIdentifiers = funcMatches.filter(m =>
        m.includes('(') ||
        m.includes('_') ||
        /[a-z][A-Z]/.test(m) ||
        m.endsWith('.ts') ||
        m.endsWith('.js')
      );
      keywords.push(...codeIdentifiers.map(m => m.replace('()', '')));
    }

    // Deduplicate and filter out very short/common words
    const unique = [...new Set(keywords)].filter(k => k.length > 2);
    return unique.slice(0, 20); // Limit to 20 keywords
  }

  private searchFiles(keywords: string[]): string[] {
    const matchingFiles = new Set<string>();

    for (const keyword of keywords) {
      try {
        // Use grep to find files containing the keyword
        const result = execSync(
          `grep -rl --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" -m 5 "${keyword.replace(/"/g, '\\"')}" .`,
          {
            cwd: this.workingDir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 10000
          }
        );

        const files = result.trim().split('\n').filter(f => f.length > 0);
        for (const file of files) {
          // Skip node_modules, dist, build directories
          if (!file.includes('node_modules') && !file.includes('/dist/') && !file.includes('/build/')) {
            matchingFiles.add(join(this.workingDir, file.replace(/^\.\//, '')));
          }
        }
      } catch {
        // grep returns non-zero when no matches found
      }
    }

    // Sort by relevance (files matching more keywords first)
    const fileScores = new Map<string, number>();
    for (const file of matchingFiles) {
      let score = 0;
      try {
        const content = readFileSync(file, 'utf-8');
        for (const keyword of keywords) {
          if (content.includes(keyword)) {
            score++;
          }
        }
      } catch {
        // Skip
      }
      fileScores.set(file, score);
    }

    return [...matchingFiles]
      .sort((a, b) => (fileScores.get(b) || 0) - (fileScores.get(a) || 0))
      .slice(0, 15); // Limit to 15 most relevant files
  }

  private getFileTree(): string {
    try {
      const result = execSync(
        'find . -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.git/*" | head -200',
        {
          cwd: this.workingDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000
        }
      );
      return `File tree:\n${result}`;
    } catch {
      return 'Could not generate file tree';
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
