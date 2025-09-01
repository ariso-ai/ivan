#!/usr/bin/env node

import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface PlannerEnv {
  USER_REQUEST: string;
  REPOSITORY: string;
}

interface TaskPlan {
  title: string;
  description: string;
  order: number;
}

interface TaskPlanResponse {
  tasks: TaskPlan[];
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

async function main() {
  const env = process.env as unknown as PlannerEnv;

  console.log('📋 Task Planner Starting');
  console.log(`Request: ${env.USER_REQUEST}\n`);

  try {
    // Clone repository
    console.log('📥 Cloning repository...');
    await executeCommand(`git clone ${env.REPOSITORY} /workspace/repo`);
    process.chdir('/workspace/repo');

    const prompt = `You are a task planner. Break down the following request into individual tasks to be executed independently by Claude Code. Read the relevant parts of the current codebase to determine the best way to go about this.
Each task should be:
- Self-contained and executable independently
- Clear and specific about what needs to be done
- Should not be single atomic changes, should be larger chunks of work
- Named with a short, branch-friendly identifier (alphanumeric, hyphens only)

If the task being requested is already very simple, please return only a single task outlining what the user wants.

Do not return more than 5 tasks.

User Request: ${env.USER_REQUEST}

Respond ONLY with a JSON object in this exact format, no other text:
{
  "tasks": [
    {
      "title": "short-task-name",
      "description": "Detailed description of what this task should accomplish",
      "order": 1
    }
  ]
}`;

    console.log('🤔 Planning tasks with Claude...');

    // Use spawn to call Claude with real-time output
    const claudeProcess = spawn('claude', [
      '-p',
      prompt,
      '--verbose',
      '--output-format',
      'json',
      '--permission-mode',
      'plan'
    ]);

    let stdout = '';
    let stderr = '';

    claudeProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
    });

    claudeProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      process.stderr.write(chunk);
    });

    await new Promise<void>((resolve, reject) => {
      claudeProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve();
        }
      });

      claudeProcess.on('error', (error) => {
        reject(new Error(`Failed to start Claude CLI: ${error}`));
      });
    });

    // Parse the Claude CLI response
    const claudeResponse = JSON.parse(stdout);

    // Extract the JSON from the result field (may be wrapped in ```json blocks)
    let resultContent = claudeResponse.result;

    // Remove markdown code blocks if present
    resultContent = resultContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');

    const response = JSON.parse(resultContent) as TaskPlanResponse;

    console.log(`✓ Planned ${response.tasks.length} tasks`);

    // Output the result as JSON for the parent process to read
    console.log('TASK_PLAN_START');
    console.log(JSON.stringify(response));
    console.log('TASK_PLAN_END');

  } catch (error) {
    console.error('❌ Task planning failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
