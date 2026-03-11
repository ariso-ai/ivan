import { describe, it } from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert';

describe('CLI behavior', () => {
  const cliPath = join(process.cwd(), 'dist', 'index.js');

  it('should display help when --help flag is passed', () => {
    const output = execSync(`node ${cliPath} --help`, {
      encoding: 'utf-8'
    });

    assert.ok(
      output.includes('Ivan - A coding orchestration agent CLI'),
      'Help output should contain CLI description'
    );
    assert.ok(output.includes('Usage:'), 'Help output should contain Usage');
    assert.ok(
      output.includes('Options:'),
      'Help output should contain Options'
    );
  });

  it('should display version when --version flag is passed', () => {
    const output = execSync(`node ${cliPath} --version`, {
      encoding: 'utf-8'
    });

    assert.match(
      output.trim(),
      /\d+\.\d+\.\d+/,
      'Version output should match semver format'
    );
  });

  it('should enter standard interactive flow when no arguments are passed', (t, done) => {
    const child = spawn('node', [cliPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let hasStartedInteractive = false;

    const timeout = globalThis.setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
      done(new Error('Test timed out after 10 seconds'));
    }, 10000);

    child.stdout.on('data', (data) => {
      output += data.toString();

      if (
        output.includes('Ivan is not configured') ||
        output.includes('Anthropic API') ||
        output.includes('OpenAI API') ||
        output.includes('Enter your task') ||
        output.includes('Starting Ivan workflow') ||
        output.includes('Enter the path to your target repository')
      ) {
        hasStartedInteractive = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', () => {
      globalThis.clearTimeout(timeout);

      try {
        assert.ok(
          !output.includes('Usage: ivan [options]'),
          'Should not show help text when no arguments are passed'
        );
        assert.ok(
          hasStartedInteractive,
          'Should enter interactive/configuration mode'
        );
        done();
      } catch (err) {
        done(err);
      }
    });
  });

  it('should show recognized commands in help', () => {
    const output = execSync(`node ${cliPath} --help`, {
      encoding: 'utf-8'
    });

    assert.ok(
      output.includes('reconfigure'),
      'Help should include reconfigure command'
    );
    assert.ok(
      output.includes('config-tools'),
      'Help should include config-tools command'
    );
    assert.ok(
      output.includes('address'),
      'Help should include address command'
    );
    assert.ok(output.includes('web'), 'Help should include web command');
  });
});
