import { spawn } from 'child_process';
import chalk from 'chalk';

export interface TaskPlan {
  title: string;
  description: string;
  order: number;
}

export interface TaskPlanResponse {
  tasks: TaskPlan[];
}

export class ClaudePlannerService {
  async planTasks(userRequest: string): Promise<TaskPlanResponse> {
    console.log(chalk.gray('🤔 Planning tasks with Claude Code...'));

    const prompt = `You are a task planner. Break down the following request into individual tasks to be executed independently by Claude Code. Read the relevant parts of the current codebase to determine the best way to go about this 
Each task should be:
- Self-contained and executable independently
- Clear and specific about what needs to be done
- Should not be single atomic changes, should be larger chunks of work
- Named with a short, branch-friendly identifier (alphanumeric, hyphens only)

If the task being requested is already very simple, please return only a single task outlining what the user wants.

Do not return more than 5 tasks.

User Request: ${userRequest}

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

    try {
      return new Promise((resolve, reject) => {
        console.log(chalk.gray('Calling Claude CLI...'));
        
        const claudeProcess = spawn('claude', [
          '-p',
          prompt,
          '--output-format',
          'json'
        ]);

        let stdout = '';
        let stderr = '';

        claudeProcess.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          // Stream output for debugging
          process.stdout.write(chalk.dim(chunk));
        });

        claudeProcess.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          process.stderr.write(chalk.red(chunk));
        });

        claudeProcess.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
            return;
          }

          try {
            // Parse the Claude CLI response
            const claudeResponse = JSON.parse(stdout);
            
            // Extract the JSON from the result field (may be wrapped in ```json blocks)
            let resultContent = claudeResponse.result;
            
            // Remove markdown code blocks if present
            resultContent = resultContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            
            const response = JSON.parse(resultContent) as TaskPlanResponse;
            
            console.log(chalk.green(`\n✓ Planned ${response.tasks.length} tasks`));
            resolve(response);
          } catch (parseError) {
            reject(new Error(`Failed to parse Claude response: ${parseError}`));
          }
        });

        claudeProcess.on('error', (error) => {
          reject(new Error(`Failed to start Claude CLI: ${error}`));
        });
      });
    } catch (error) {
      console.error(chalk.red('Failed to plan tasks:'), error);
      throw new Error('Task planning failed');
    }
  }
}

