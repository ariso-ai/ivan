import chalk from 'chalk';
import inquirer from 'inquirer';
import { ExecutorFactory } from './executor-factory.js';
import { DatabaseManager } from '../database.js';
import { LearningService } from './learning-service.js';
import type { OnboardingQuestion } from './learning-service.js';
import ora from 'ora';

export class LearnExecutor {
  private dbManager: DatabaseManager;
  private learningService: LearningService;

  constructor() {
    this.dbManager = new DatabaseManager();
    this.learningService = new LearningService(this.dbManager);
  }

  async execute(workingDir: string): Promise<void> {
    console.log(chalk.blue.bold('\n🎓 Ivan Learning Mode\n'));
    console.log(
      chalk.yellow(
        'I\'ll analyze this repository and generate specific questions about patterns, conventions, and nuances that a new engineer should know.\n'
      )
    );

    // Ensure migrations are run
    await this.dbManager.runMigrations();

    // Get or create repository
    const repositoryId = await this.getOrCreateRepository(workingDir);

    console.log(chalk.cyan(`📦 Repository ID: ${repositoryId}\n`));

    // Generate repository-specific questions using Claude
    const questions = await this.generateQuestions(workingDir);

    if (questions.length === 0) {
      console.log(chalk.yellow('No questions generated. Exiting.'));
      return;
    }

    console.log(
      chalk.green(`\n✅ Generated ${questions.length} questions about this repository\n`)
    );

    // Process each question
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(
        chalk.blue.bold(`\n[${i + 1}/${questions.length}] ${question.question}\n`)
      );

      await this.processQuestion(question, workingDir, repositoryId);
    }

    console.log(
      chalk.green.bold('\n✅ Learning session completed!\n')
    );
    console.log(
      chalk.cyan(
        'All learnings have been saved and can be used to help future engineers understand this codebase.\n'
      )
    );
  }

  private async getOrCreateRepository(workingDir: string): Promise<number> {
    const db = this.dbManager.getKysely();

    // Try to find existing repository
    const existing = await db
      .selectFrom('repositories')
      .selectAll()
      .where('directory', '=', workingDir)
      .executeTakeFirst();

    if (existing) {
      return existing.id;
    }

    // Create new repository
    const repoName = workingDir.split('/').pop() || 'unknown';
    const result = await db
      .insertInto('repositories')
      .values({
        directory: workingDir,
        name: repoName,
        remote_url: null
      })
      .executeTakeFirst();

    if (result.insertId === undefined) {
      throw new Error('Failed to create repository: no insertId returned');
    }
    return Number(result.insertId);
  }

  private async generateQuestions(workingDir: string): Promise<OnboardingQuestion[]> {
    const spinner = ora('Analyzing repository to generate specific questions...').start();

    try {
      const executor = ExecutorFactory.getExecutor();

      const prompt = `Analyze this codebase and generate 10-12 specific questions that would help a new engineer understand the patterns, conventions, and nuances of this project.

Focus on:
- Code organization patterns (how are files/modules structured?)
- Naming conventions (files, functions, variables, classes)
- How to write migrations, tests, or other common tasks
- Specific architectural patterns used (e.g., service pattern, factory pattern)
- Error handling approaches
- State management patterns
- API design conventions
- Database interaction patterns
- Configuration and environment setup specifics
- Build and deployment specifics
- Testing patterns and conventions
- Any unique or non-standard approaches used

DO NOT ask generic questions like "what is the tech stack" or "what are the main features".
DO ask specific questions about HOW things are done in THIS codebase.

Examples of good questions:
- "How do you prefer to write database migrations in this project?"
- "What naming convention is used for service classes and their files?"
- "How is error handling typically implemented in API endpoints?"
- "What pattern is used for dependency injection or service initialization?"
- "How are database queries structured (raw SQL, query builder, ORM)?"

Return your response as a JSON array of objects with this structure:
[
  {
    "question": "The specific question",
    "context": "Brief context about where to look or what to examine to answer this question"
  }
]

Return ONLY the JSON array, no additional text.`;

      const result = await executor.executeTask(prompt, workingDir);
      spinner.succeed('Questions generated');

      // Parse the JSON response
      const response = result.lastMessage.trim();

      // Try to extract JSON from the response
      let jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        // Try to find JSON in code blocks
        jsonMatch = response.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
        if (jsonMatch) {
          jsonMatch[0] = jsonMatch[1];
        }
      }

      if (!jsonMatch) {
        console.log(chalk.yellow('\n⚠️  Could not parse questions from Claude\'s response.'));
        console.log(chalk.gray('Response:', response.substring(0, 500)));
        return [];
      }

      const questions = JSON.parse(jsonMatch[0]) as OnboardingQuestion[];

      if (!Array.isArray(questions) || questions.length === 0) {
        console.log(chalk.yellow('\n⚠️  No valid questions generated.'));
        return [];
      }

      return questions;
    } catch (error) {
      spinner.fail('Failed to generate questions');
      console.error(chalk.red('Error:'), error);
      return [];
    }
  }

  private async processQuestion(
    question: OnboardingQuestion,
    workingDir: string,
    repositoryId: number
  ): Promise<void> {
    // Step 1: Use Claude to answer the question
    let claudeAnswer: string;
    try {
      claudeAnswer = await this.askClaude(question, workingDir);
    } catch (error) {
      // If Claude fails to generate an answer, allow user to write their own
      console.log(
        chalk.yellow(
          '\n⚠️  Claude could not generate an answer. You can write your own or skip this question.\n'
        )
      );
      claudeAnswer = ''; // Empty string as fallback for manual entry
    }

    // Step 2: Ask user to confirm or edit
    const finalAnswer = await this.confirmOrEditAnswer(
      question.question,
      claudeAnswer
    );

    if (!finalAnswer) {
      console.log(chalk.yellow('⏭️  Skipped\n'));
      return;
    }

    // Step 3: Ask for relevant files
    const files = await this.promptForFiles(claudeAnswer);

    // Step 4: Save the learning
    await this.learningService.saveLearning({
      question: question.question,
      answer: finalAnswer,
      files: files,
      repositoryId: repositoryId
    });

    console.log(chalk.green('✅ Learning saved!\n'));
  }

  private async askClaude(
    question: OnboardingQuestion,
    workingDir: string
  ): Promise<string> {
    const spinner = ora('Asking Claude to explore the codebase...').start();

    try {
      const executor = ExecutorFactory.getExecutor();

      // Construct a detailed prompt for Claude
      const prompt = `${question.question}

Context: ${question.context}

Please explore the codebase thoroughly and provide a comprehensive answer. Focus on:
- Being specific with file paths and code examples where relevant
- Explaining patterns and conventions used
- Highlighting important details a new engineer should know

Keep the answer concise but informative (aim for 3-5 paragraphs).`;

      const result = await executor.executeTask(prompt, workingDir);

      spinner.succeed('Claude finished exploring');

      return result.lastMessage || result.log;
    } catch (error) {
      spinner.fail('Failed to get answer from Claude');
      console.error(chalk.red('Error:'), error);
      throw error; // Force error handling at the caller level
    }
  }

  private async confirmOrEditAnswer(
    question: string,
    claudeAnswer: string
  ): Promise<string | null> {
    // If claudeAnswer is empty, don't show it and force manual entry
    if (claudeAnswer.trim()) {
      console.log(chalk.cyan('\n📝 Claude\'s Answer:\n'));
      console.log(chalk.white(claudeAnswer));
      console.log('');
    }

    // If answer is empty, don't allow "Accept as-is" option
    const choices = claudeAnswer.trim()
      ? [
        { name: '✅ Accept as-is', value: 'accept' },
        { name: '✏️  Edit the answer', value: 'edit' },
        { name: '✍️  Write my own answer', value: 'rewrite' },
        { name: '⏭️  Skip this question', value: 'skip' }
      ]
      : [
        { name: '✍️  Write my own answer', value: 'rewrite' },
        { name: '⏭️  Skip this question', value: 'skip' }
      ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do with this answer?',
        choices
      }
    ]);

    switch (action) {
    case 'accept':
      return claudeAnswer;

    case 'edit': {
      const { edited } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'edited',
          message: 'Edit the answer (press Enter to open editor):',
          default: claudeAnswer
        }
      ]);
      return edited.trim() || null;
    }

    case 'rewrite': {
      const { custom } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'custom',
          message: 'Write your answer (press Enter to open editor):',
          default: ''
        }
      ]);
      return custom.trim() || null;
    }

    case 'skip':
      return null;

    default:
      return null;
    }
  }

  private async promptForFiles(claudeAnswer: string): Promise<string[]> {
    // Try to extract file paths from Claude's answer
    const filePathRegex = /(?:^|\s)([a-zA-Z0-9_\-./]+\.(ts|js|json|tsx|jsx|py|go|java|rb|php|css|scss|html|md|yml|yaml|toml|sh|Dockerfile))/gm;
    const matches = claudeAnswer.matchAll(filePathRegex);
    const detectedFiles = Array.from(new Set(Array.from(matches, m => m[1])));

    const { shouldAddFiles } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldAddFiles',
        message: 'Would you like to associate specific files with this learning?',
        default: detectedFiles.length > 0
      }
    ]);

    if (!shouldAddFiles) {
      return [];
    }

    const { files } = await inquirer.prompt([
      {
        type: 'input',
        name: 'files',
        message: 'Enter file paths (comma-separated):',
        default: detectedFiles.join(', '),
        filter: (input: string) => {
          return input
            .split(',')
            .map((f) => f.trim())
            .filter((f) => f.length > 0);
        }
      }
    ]);

    return files;
  }

  async close(): Promise<void> {
    this.dbManager.close();
  }
}
