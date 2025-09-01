#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { Database as DatabaseSchema } from '../database/types.js';

const execAsync = promisify(exec);

interface TaskExecutorEnv {
  TASK_ID: string;
  TASK_TITLE: string;
  TASK_DESCRIPTION: string;
  BRANCH_NAME: string;
  REPOSITORY: string;
  OPENAI_API_KEY: string;
  IVAN_DB_PATH: string;
}

async function executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(command);
    return { stdout, stderr };
  } catch (error: any) {
    console.error(`Command failed: ${command}`);
    console.error(error);
    throw error;
  }
}

async function generateCommitMessage(changes: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('OpenAI API key not provided, using default commit message');
    return `feat: complete task ${process.env.TASK_TITLE}`;
  }

  const openai = new OpenAI({
    apiKey: apiKey
  });

  const prompt = `Based on the following git diff, generate a concise and meaningful commit message. 
The message should follow conventional commit format (feat:, fix:, docs:, etc.) and be under 72 characters.
Respond with ONLY the commit message, no other text.

Changes:
${changes.substring(0, 2000)}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that generates clear, concise git commit messages.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    const message = completion.choices[0]?.message?.content?.trim();
    return message || `feat: complete task ${process.env.TASK_TITLE}`;
  } catch (error) {
    console.error('Failed to generate commit message:', error);
    return `feat: complete task ${process.env.TASK_TITLE}`;
  }
}

async function main() {
  const env = process.env as unknown as TaskExecutorEnv;

  console.log('\n📦 Task Executor Starting');
  console.log(`Task: ${env.TASK_TITLE}`);
  console.log(`Description: ${env.TASK_DESCRIPTION}\n`);

  try {
    // Clone repository
    console.log('📥 Cloning repository...');
    await executeCommand(`git clone ${env.REPOSITORY} /workspace/repo`);
    process.chdir('/workspace/repo');

    // Create and checkout branch
    console.log(`🌿 Creating branch: ${env.BRANCH_NAME}`);
    await executeCommand(`git checkout -b ${env.BRANCH_NAME}`);

    // Execute Claude Code with the task
    console.log('🤖 Running Claude Code...');
    const claudeCommand = `echo '${env.TASK_DESCRIPTION.replace(/'/g, "'\\''")}' | claude --dangerously-skip-permissions`;
    await executeCommand(claudeCommand);

    // Check for changes
    const { stdout: statusOutput } = await executeCommand('git status --porcelain');

    if (statusOutput.trim()) {
      console.log('📝 Changes detected, preparing commit...');

      // Add all changes
      await executeCommand('git add -A');

      // Get diff for commit message
      const { stdout: diffOutput } = await executeCommand('git diff --cached');

      // Generate commit message
      console.log('✍️  Generating commit message...');
      const commitMessage = await generateCommitMessage(diffOutput);

      // Commit changes
      console.log(`💾 Committing: ${commitMessage}`);
      await executeCommand(`git commit -m "${commitMessage}"`);

      console.log('✅ Task completed successfully!');
    } else {
      console.log('ℹ️  No changes were made by Claude Code');
    }

    // Update task status in database
    if (env.IVAN_DB_PATH && fs.existsSync(env.IVAN_DB_PATH)) {
      const sqlite = new Database(env.IVAN_DB_PATH);
      const db = new Kysely<DatabaseSchema>({
        dialect: new SqliteDialect({
          database: sqlite
        })
      });

      await db
        .updateTable('tasks')
        .set({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .where('id', '=', parseInt(env.TASK_ID))
        .execute();

      await db.destroy();
    }

  } catch (error) {
    console.error('❌ Task execution failed:', error);

    // Update task status to failed
    if (env.IVAN_DB_PATH && fs.existsSync(env.IVAN_DB_PATH)) {
      const sqlite = new Database(env.IVAN_DB_PATH);
      const db = new Kysely<DatabaseSchema>({
        dialect: new SqliteDialect({
          database: sqlite
        })
      });

      await db
        .updateTable('tasks')
        .set({
          status: 'failed',
          updated_at: new Date().toISOString()
        })
        .where('id', '=', parseInt(env.TASK_ID))
        .execute();

      await db.destroy();
    }

    process.exit(1);
  }
}

main().catch(console.error);
