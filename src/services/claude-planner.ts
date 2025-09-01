import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

export interface TaskPlan {
  title: string;
  description: string;
  order: number;
}

export interface TaskPlanResponse {
  tasks: TaskPlan[];
}

export class ClaudePlannerService {
  async planTasks(userRequest: string, repository: string): Promise<TaskPlanResponse> {
    console.log(chalk.gray('🤔 Planning tasks with Claude Code...'));
    
    const prompt = `You are a task planner. Break down the following request into individual, atomic tasks that can be executed independently by Claude Code.
Each task should be:
- Self-contained and executable independently
- Clear and specific about what needs to be done
- Small enough to be completed in a single session
- Named with a short, branch-friendly identifier (alphanumeric, hyphens only)

Repository: ${repository}
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
      const command = `echo '${prompt.replace(/'/g, "'\\''")}' | claude --json`;
      const { stdout } = await execAsync(command);
      
      const response = JSON.parse(stdout) as TaskPlanResponse;
      
      console.log(chalk.green(`✓ Planned ${response.tasks.length} tasks`));
      return response;
    } catch (error) {
      console.error(chalk.red('Failed to plan tasks:'), error);
      throw new Error('Task planning failed');
    }
  }
}