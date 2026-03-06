import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import type { Selectable } from 'kysely';
import { DatabaseManager, Repository } from '../database.js';
import type { IRepositoryManager, RepositoryInfo } from './git-interfaces.js';

export class RepositoryManagerCLI implements IRepositoryManager {
  private dbManager: DatabaseManager;

  constructor() {
    this.dbManager = new DatabaseManager();
  }
  async getValidWorkingDirectory(): Promise<string> {
    const currentDir = process.cwd();

    if (this.isValidTargetRepository(currentDir)) {
      return currentDir;
    }

    console.log(chalk.yellow('⚠️  Current directory is not a valid target repository'));

    if (!this.isGitRepository(currentDir)) {
      console.log(chalk.red('❌ Not a git repository'));
    } else if (this.isIvanRepository(currentDir)) {
      console.log(chalk.red('❌ Cannot run Ivan on itself'));
    }

    return await this.promptForRepositoryPath();
  }

  private isGitRepository(dir: string): boolean {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: dir,
        stdio: 'ignore'
      });
      return true;
    } catch {
      return false;
    }
  }

  private isIvanRepository(dir: string): boolean {
    try {
      const packageJsonPath = path.join(dir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        return false;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return packageJson.name === '@ariso-ai/ivan' || packageJson.name === 'ivan';
    } catch {
      return false;
    }
  }

  private isValidTargetRepository(dir: string): boolean {
    return this.isGitRepository(dir) && !this.isIvanRepository(dir);
  }

  private async promptForRepositoryPath(): Promise<string> {
    console.log('');
    console.log(chalk.blue('📁 Please specify the repository where Ivan should work'));

    while (true) {
      const { repositoryPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'repositoryPath',
          message: 'Enter the path to your target repository:',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Please enter a valid path';
            }
            return true;
          }
        }
      ]);

      const fullPath = path.resolve(repositoryPath.trim());

      if (!fs.existsSync(fullPath)) {
        console.log(chalk.red('❌ Path does not exist'));
        continue;
      }

      if (!fs.statSync(fullPath).isDirectory()) {
        console.log(chalk.red('❌ Path is not a directory'));
        continue;
      }

      if (!this.isGitRepository(fullPath)) {
        console.log(chalk.red('❌ Path is not a git repository'));
        continue;
      }

      if (this.isIvanRepository(fullPath)) {
        console.log(chalk.red('❌ Cannot run Ivan on itself'));
        continue;
      }

      console.log(chalk.green(`✅ Using repository: ${fullPath}`));
      return fullPath;
    }
  }

  getRepositoryInfo(workingDir: string): RepositoryInfo {
    try {
      const repoName = path.basename(workingDir);
      const branch = execSync('git branch --show-current', {
        cwd: workingDir,
        encoding: 'utf8'
      }).trim();

      return { name: repoName, branch };
    } catch {
      return { name: path.basename(workingDir), branch: 'unknown' };
    }
  }

  private getRemoteUrl(workingDir: string): string | null {
    try {
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: workingDir,
        encoding: 'utf8'
      }).trim();
      return remoteUrl || null;
    } catch {
      return null;
    }
  }

  async getOrCreateRepository(workingDir: string): Promise<Selectable<Repository>> {
    const db = this.dbManager.getKysely();

    // Check if repository exists
    const existingRepo = await db
      .selectFrom('repositories')
      .selectAll()
      .where('directory', '=', workingDir)
      .executeTakeFirst();

    if (existingRepo) {
      return existingRepo;
    }

    // Create new repository
    const { name } = this.getRepositoryInfo(workingDir);
    const remoteUrl = this.getRemoteUrl(workingDir);

    await db.insertInto('repositories').values({
      remote_url: remoteUrl,
      directory: workingDir,
      name
    }).execute();

    // Fetch the created repository with its id
    const createdRepo = await db
      .selectFrom('repositories')
      .selectAll()
      .where('directory', '=', workingDir)
      .executeTakeFirstOrThrow();

    return createdRepo;
  }

  close(): void {
    this.dbManager.close();
  }
}
