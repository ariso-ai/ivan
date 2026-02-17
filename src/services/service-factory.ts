import { ConfigManager } from '../config.js';
import { IGitManager, IPRService, IRepositoryManager } from './git-interfaces.js';
import { GitManagerCLI } from './git-manager-cli.js';
import { GitManagerPAT } from './git-manager-pat.js';
import { PRServiceCLI } from './pr-service-cli.js';
import { PRServicePAT } from './pr-service-pat.js';
import { RepositoryManagerCLI } from './repository-manager-cli.js';
import { RepositoryManagerPAT } from './repository-manager-pat.js';

/**
 * Factory class for creating service instances based on GitHub authentication configuration
 */
export class ServiceFactory {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  /**
   * Create a GitManager instance based on the configured authentication type
   */
  createGitManager(workingDir: string): IGitManager {
    const authType = this.configManager.getGithubAuthType();

    if (authType === 'pat') {
      const pat = this.configManager.getGithubPat();
      if (!pat) {
        throw new Error('GitHub PAT is not configured. Please run "ivan configure" and set your PAT.');
      }
      return new GitManagerPAT(workingDir, pat);
    } else {
      // Default to CLI
      return new GitManagerCLI(workingDir);
    }
  }

  /**
   * Create a PRService instance based on the configured authentication type
   */
  createPRService(workingDir: string): IPRService {
    const authType = this.configManager.getGithubAuthType();

    if (authType === 'pat') {
      const pat = this.configManager.getGithubPat();
      if (!pat) {
        throw new Error('GitHub PAT is not configured. Please run "ivan configure" and set your PAT.');
      }
      return new PRServicePAT(workingDir, pat);
    } else {
      // Default to CLI
      return new PRServiceCLI(workingDir);
    }
  }

  /**
   * Create a RepositoryManager instance based on the configured authentication type
   */
  createRepositoryManager(): IRepositoryManager {
    const authType = this.configManager.getGithubAuthType();

    if (authType === 'pat') {
      return new RepositoryManagerPAT();
    } else {
      // Default to CLI
      return new RepositoryManagerCLI();
    }
  }
}

/**
 * Convenience functions for creating service instances
 */

export function createGitManager(workingDir: string): IGitManager {
  const factory = new ServiceFactory();
  return factory.createGitManager(workingDir);
}

export function createPRService(workingDir: string): IPRService {
  const factory = new ServiceFactory();
  return factory.createPRService(workingDir);
}

export function createRepositoryManager(): IRepositoryManager {
  const factory = new ServiceFactory();
  return factory.createRepositoryManager();
}
