import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

let ivanProcess: ChildProcess;

test.beforeAll(async () => {
  // Start `ivan web` in the background on port 3000
  ivanProcess = spawn('ivan', ['web', '--port', '3000'], {
    stdio: 'pipe',
    env: { ...process.env },
    detached: false,
  });

  ivanProcess.stderr?.on('data', (data) => process.stderr.write(data));

  // Give the Express server a moment to bind
  await sleep(3000);
});

test.afterAll(async () => {
  if (ivanProcess && !ivanProcess.killed) {
    ivanProcess.kill('SIGTERM');
  }
});

test('ivan web dashboard boots and serves the jobs UI', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Assert the dashboard page loaded meaningfully
  await expect(page).toHaveTitle(/Ivan/i);

  // The dashboard renders a jobs section (from web-server.ts routes)
  await expect(
    page.getByText(/jobs/i).first()
  ).toBeVisible({ timeout: 10_000 });
});
