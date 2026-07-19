import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';

interface Keypress {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

/**
 * Captures additional context the user types while an Ivan command is running,
 * similar to interjecting in an interactive Claude Code session.
 *
 * Input is read in raw mode with the echo rendered by this class on its own
 * input line — a spinner redrawing its line would otherwise wipe the
 * terminal's native echo, making typing invisible. While the user is
 * composing, the active spinner (registered via claudeSpinner) is paused, and
 * resumed when the input is submitted or cancelled.
 *
 * Each submitted line is either delivered immediately to a live listener (the
 * SDK executor streams it into the running session mid-turn) or buffered until
 * the next turn starts (the CLI executor applies it in an automatic follow-up
 * turn).
 */
export class InterjectionManager {
  private static instance: InterjectionManager | null = null;

  static getInstance(): InterjectionManager {
    if (!InterjectionManager.instance) {
      InterjectionManager.instance = new InterjectionManager();
    }
    return InterjectionManager.instance;
  }

  private refCount = 0;
  private listening = false;
  private keypressAttached = false;
  private rawModeSet = false;
  private buffer = '';
  private pending: string[] = [];
  private liveListener: ((text: string) => void) | null = null;
  private hintShown = false;
  private activeSpinner: Ora | null = null;
  private pausedSpinner: Ora | null = null;
  private keypressHandler = (str: string | undefined, key: Keypress) =>
    this.handleKeypress(str, key);

  /** Interjections require an interactive terminal. */
  isAvailable(): boolean {
    return Boolean(process.stdin.isTTY);
  }

  /**
   * Begin capturing keystrokes. Ref-counted so overlapping turns can
   * start/stop freely; the listener is only torn down when the outermost
   * stop() is reached.
   */
  start(quiet = false): void {
    if (!this.isAvailable()) return;
    this.refCount++;
    if (this.listening) return;
    this.listening = true;
    if (!this.keypressAttached) {
      readline.emitKeypressEvents(process.stdin);
      this.keypressAttached = true;
    }
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
      this.rawModeSet = true;
    }
    process.stdin.on('keypress', this.keypressHandler);
    process.stdin.resume();
    if (!this.hintShown && !quiet) {
      console.log(
        chalk.cyan(
          '💬 Type a message and press Enter at any time to give Ivan additional context'
        )
      );
      this.hintShown = true;
    }
  }

  /** Stop capturing keystrokes once all active turns have finished. */
  stop(): void {
    if (!this.isAvailable()) return;
    if (this.refCount > 0) this.refCount--;
    if (this.refCount === 0 && this.listening) {
      this.listening = false;
      process.stdin.removeListener('keypress', this.keypressHandler);
      if (this.rawModeSet) {
        process.stdin.setRawMode(false);
        this.rawModeSet = false;
      }
      // Release stdin so the process can exit and later prompts (inquirer)
      // get a clean stream.
      process.stdin.pause();
      // Abandon any partially typed input and restore the spinner.
      if (this.buffer) {
        this.buffer = '';
        this.clearInputLine();
      }
      this.resumeSpinner();
    }
  }

  /**
   * Registers the spinner currently rendering so it can be paused while the
   * user types (its line redraws would erase the input echo otherwise).
   */
  attachSpinner(spinner: Ora): void {
    this.activeSpinner = spinner;
  }

  detachSpinner(spinner: Ora): void {
    if (this.activeSpinner === spinner) this.activeSpinner = null;
    if (this.pausedSpinner === spinner) this.pausedSpinner = null;
  }

  /**
   * Register a handler that receives interjections the moment they are typed
   * (used by the SDK executor to stream them into the running session).
   * Returns a release function; after release, new input buffers again.
   */
  setLiveListener(listener: (text: string) => void): () => void {
    this.liveListener = listener;
    return () => {
      if (this.liveListener === listener) this.liveListener = null;
    };
  }

  /** Returns and clears any buffered interjections. */
  drainPending(): string[] {
    return this.pending.splice(0);
  }

  /**
   * Puts interjections back at the front of the buffer — used when a turn
   * ends before delivering input it had already accepted.
   */
  requeue(texts: string[]): void {
    if (texts.length > 0) this.pending.unshift(...texts);
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  private handleKeypress(str: string | undefined, key: Keypress = {}): void {
    if (key.ctrl && key.name === 'c') {
      // Raw mode suppresses the terminal's own SIGINT; re-emit it so the
      // executors' Ctrl+C handlers still fire.
      if (this.rawModeSet) process.kill(process.pid, 'SIGINT');
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      this.submit();
      return;
    }
    if (key.name === 'backspace') {
      if (this.buffer) {
        this.buffer = this.buffer.slice(0, -1);
        this.render();
      }
      return;
    }
    if (key.ctrl && key.name === 'u') {
      this.buffer = '';
      this.render();
      return;
    }
    if (key.name === 'escape') {
      this.buffer = '';
      this.clearInputLine();
      this.resumeSpinner();
      return;
    }
    if (key.ctrl || key.meta) return;
    // Printable input only (pasted text arrives as a multi-char str).
    if (!str) return;
    const printable = Array.from(str)
      .filter((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 0x20 && code !== 0x7f;
      })
      .join('');
    if (!printable) return;
    if (this.buffer.length === 0) this.pauseSpinner();
    this.buffer += printable;
    this.render();
  }

  private submit(): void {
    const text = this.buffer.trim();
    this.buffer = '';
    this.clearInputLine();
    if (text) {
      if (this.liveListener) {
        this.liveListener(text);
        console.log(
          chalk.cyan(
            '💬 Context sent to Claude — it will be incorporated into the current task'
          )
        );
      } else {
        this.pending.push(text);
        console.log(
          chalk.cyan(
            '💬 Context queued — Ivan will include it in the next turn'
          )
        );
      }
    }
    this.resumeSpinner();
  }

  /**
   * Redraws the input line. The spinner is paused while composing, so this
   * line owns the cursor row; streamed Claude output may still scroll it away,
   * in which case the next keypress redraws the full buffer.
   */
  private render(): void {
    if (!this.listening) return;
    process.stderr.write('\r\x1b[2K' + chalk.cyan('💬 > ') + this.buffer);
  }

  private clearInputLine(): void {
    process.stderr.write('\r\x1b[2K');
  }

  private pauseSpinner(): void {
    const spinner = this.activeSpinner;
    if (spinner && spinner.isSpinning) {
      this.pausedSpinner = spinner;
      spinner.stop();
    }
  }

  private resumeSpinner(): void {
    // Only restart a spinner we paused ourselves that is still the active
    // one — if the executor finished it (succeed/fail) while the user was
    // typing, detachSpinner has already cleared it.
    if (this.pausedSpinner && this.pausedSpinner === this.activeSpinner) {
      this.pausedSpinner.start();
    }
    this.pausedSpinner = null;
  }
}

/**
 * Creates a spinner for phases where a Claude turn runs and interjections are
 * being captured: stdin stays readable (no discardStdin) and the spinner is
 * registered with the InterjectionManager so it pauses while the user types.
 * Finishing the spinner (succeed/fail/warn/info/stopAndPersist) detaches it;
 * plain stop() is left unwrapped because the manager itself uses it to pause.
 */
export function claudeSpinner(text: string): Ora {
  const spinner = ora({ text, discardStdin: false });
  const manager = InterjectionManager.getInstance();
  manager.attachSpinner(spinner);
  const finish =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      manager.detachSpinner(spinner);
      return fn(...args);
    };
  spinner.succeed = finish(spinner.succeed.bind(spinner));
  spinner.fail = finish(spinner.fail.bind(spinner));
  spinner.warn = finish(spinner.warn.bind(spinner));
  spinner.info = finish(spinner.info.bind(spinner));
  spinner.stopAndPersist = finish(spinner.stopAndPersist.bind(spinner));
  return spinner;
}

/**
 * Appends buffered interjections to the initial prompt of the next turn.
 */
export function appendInterjections(prompt: string, texts: string[]): string {
  if (texts.length === 0) return prompt;
  return `${prompt}\n\nAdditional context from the user (provided while Ivan was running — treat it as part of the task):\n${texts
    .map((t) => `- ${t}`)
    .join('\n')}`;
}

/**
 * Formats interjections delivered as their own message — either streamed into
 * a running SDK session or sent as a CLI follow-up turn.
 */
export function interjectionMessage(texts: string[]): string {
  return `The user interjected with additional context while you were working:\n${texts
    .map((t) => `- ${t}`)
    .join(
      '\n'
    )}\nIncorporate this guidance into the task you are working on, adjusting anything you have already done if needed.`;
}
