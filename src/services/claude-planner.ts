import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
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
  private repository: string;
  private anthropicApiKey: string;

  constructor(repository: string, anthropicApiKey: string) {
    this.repository = repository;
    this.anthropicApiKey = anthropicApiKey;
  }

  async planTasks(userRequest: string): Promise<TaskPlanResponse> {
    console.log(chalk.gray('🤔 Planning tasks with Claude Code...'));

    try {
      const homeDir = os.homedir();
      const scriptPath = path.join(process.cwd(), 'dist', 'scripts', 'task-planner.js');


      console.log(chalk.gray('Starting planning container...'));

      // Start container in background
      const containerName = `ivan-planner-${Date.now()}`;
      const startCommand = `docker run -d --name ${containerName} \
        -e USER_REQUEST="${userRequest.replace(/"/g, '\\"')}" \
        -e REPOSITORY="${this.repository}" \
        -e HOST_HOME="${homeDir}" \
        -e ANTHROPIC_API_KEY="${this.anthropicApiKey}" \
        -w /workspace \
        node:24-alpine \
        sleep 300`;

      await execAsync(startCommand);

      let stdout = '';
      let stderr = '';

      try {
        // Create app directory and copy scripts to container
        await execAsync(`docker exec ${containerName} mkdir -p /app`);
        await execAsync(`docker cp "${scriptPath}" ${containerName}:/app/task-planner.js`);
        
        const setupScript = path.join(process.cwd(), 'src', 'scripts', 'setup-container.sh');
        await execAsync(`docker cp "${setupScript}" ${containerName}:/app/setup-container.sh`);

        // Copy SSH and git configs
        await execAsync(`docker exec ${containerName} mkdir -p /root/.ssh /root/.claude/plugins`);
        await execAsync(`docker cp "${homeDir}/.ssh/." ${containerName}:/root/.ssh/`).catch(() => {});
        await execAsync(`docker cp "${homeDir}/.claude/." ${containerName}:/root/.claude/`).catch(() => {});
        await execAsync(`docker cp "${homeDir}/.gitconfig" ${containerName}:/root/.gitconfig`).catch(() => {});

        console.log('running docker')
        // Execute setup and task planning with streaming output
        const dockerProcess = spawn('docker', [
          'exec', containerName, 'sh', '-c',
          'chmod +x /app/setup-container.sh && /app/setup-container.sh && echo "Starting task planner..." && CLAUDE_CONFIG_DIR=/root/.claude node /app/task-planner.js'
        ]);

        dockerProcess.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          process.stdout.write(chunk);
        });

        dockerProcess.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          process.stderr.write(chunk);
        });

        await new Promise<void>((resolve, reject) => {
          dockerProcess.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(`Docker exec exited with code ${code}`));
            } else {
              resolve();
            }
          });

          dockerProcess.on('error', (error) => {
            reject(new Error(`Failed to execute docker command: ${error}`));
          });
        });

        console.log(chalk.gray('=== CONTAINER OUTPUT START ==='));
        console.log(stdout);
        console.log(chalk.gray('=== CONTAINER OUTPUT END ==='));

        if (stderr) {
          console.log(chalk.yellow('=== CONTAINER STDERR START ==='));
          console.log(stderr);
          console.log(chalk.yellow('=== CONTAINER STDERR END ==='));
        }
      } finally {
        // Clean up container
        await execAsync(`docker rm -f ${containerName}`).catch(() => {});
      }

      // Extract the JSON response from between the markers
      const startMarker = 'TASK_PLAN_START';
      const endMarker = 'TASK_PLAN_END';

      const startIndex = stdout.indexOf(startMarker);
      const endIndex = stdout.indexOf(endMarker);

      if (startIndex === -1 || endIndex === -1) {
        console.log(chalk.red('Failed to find task plan in output:'));
        console.log(stdout);
        throw new Error('Task plan markers not found in output');
      }

      const jsonString = stdout.substring(startIndex + startMarker.length, endIndex).trim();
      const response = JSON.parse(jsonString) as TaskPlanResponse;

      console.log(chalk.green(`✓ Planned ${response.tasks.length} tasks`));
      return response;

    } catch (error) {
      console.error(chalk.red('Failed to plan tasks:'), error);
      throw new Error('Task planning failed');
    }
  }
}

