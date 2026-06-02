// Parses Claude Code JSONL session files from ~/.claude/projects/ into clean
// conversation digests with computed conversation dynamics. Streams line-by-line
// to handle large files (up to 44MB) without loading into memory.

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

/** A single message in the ordered conversation transcript. */
export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** Clean digest of a single Claude Code session. */
export interface SessionDigest {
  sessionId: string;
  projectPath: string;
  filePath: string;
  aiTitle: string | null;
  timestamp: string;
  entrypoint: string;
  /** Ordered conversation transcript preserving original message sequence. */
  transcript: TranscriptMessage[];
  /** Convenience: just user text messages (derived from transcript). */
  userMessages: string[];
  dynamics: {
    turnCount: number;
    correctionDensity: number;
    questionCount: number;
    avgUserMsgLength: number;
    hasEscalationArc: boolean;
    topicShifts: number;
  };
  fileSize: number;
  fileModifiedAt: string;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

/**
 * Discovers all main session JSONL files across all Claude Code projects.
 * Skips subagent sessions (inside UUID subdirectories).
 */
export function discoverSessionFiles(options?: {
  project?: string;
  recentDays?: number;
}): Array<{ filePath: string; projectPath: string; sessionId: string }> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  const entries = fs.readdirSync(projectsDir);
  const results: Array<{
    filePath: string;
    projectPath: string;
    sessionId: string;
  }> = [];

  const cutoff = options?.recentDays
    ? Date.now() - options.recentDays * 86_400_000
    : 0;

  for (const dirName of entries) {
    const dirPath = path.join(projectsDir, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    // Filter by project name if specified
    if (options?.project) {
      const projectSlug = dirName.toLowerCase();
      if (!projectSlug.includes(options.project.toLowerCase())) continue;
    }

    // Find JSONL files directly in the project directory (not in subdirs/subagents)
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      // Filter by recency
      if (cutoff > 0 && stat.mtimeMs < cutoff) continue;

      const sessionId = file.replace('.jsonl', '');
      results.push({
        filePath,
        projectPath: dirName,
        sessionId
      });
    }
  }

  return results;
}

/**
 * Parses a single JSONL session file into a SessionDigest.
 * Streams line-by-line to handle large files efficiently.
 */
export async function parseSessionFile(
  filePath: string,
  projectPath: string,
  sessionId: string
): Promise<SessionDigest | null> {
  const stat = fs.statSync(filePath);
  const messages: ParsedMessage[] = [];
  let aiTitle: string | null = null;
  let firstTimestamp: string | null = null;
  let entrypoint = 'unknown';

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const type = obj['type'] as string;

    if (type === 'ai-title') {
      aiTitle = (obj['aiTitle'] as string) ?? null;
      continue;
    }

    if (type !== 'user' && type !== 'assistant') continue;

    const message = obj['message'] as Record<string, unknown> | undefined;
    if (!message) continue;

    const role = message['role'] as string;
    if (role !== 'user' && role !== 'assistant') continue;

    const timestamp = obj['timestamp'] as string;
    if (!firstTimestamp && timestamp) {
      firstTimestamp = timestamp;
      entrypoint = (obj['entrypoint'] as string) ?? 'unknown';
    }

    const text = extractTextContent(message, role);
    if (!text) continue;

    messages.push({ role, text, timestamp });
  }

  const transcript: TranscriptMessage[] = messages.map((m) => ({
    role: m.role,
    text: m.role === 'assistant' ? m.text.slice(0, 500) : m.text
  }));
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.text);

  // Pre-filter: need at least 3 genuine user text messages
  if (userMessages.length < 3) return null;

  const dynamics = computeDynamics(messages);

  // Pre-filter: need at least 4 turns
  if (dynamics.turnCount < 4) return null;

  return {
    sessionId,
    projectPath,
    filePath,
    aiTitle,
    timestamp: firstTimestamp ?? stat.birthtime.toISOString(),
    entrypoint,
    transcript,
    userMessages,
    dynamics,
    fileSize: stat.size,
    fileModifiedAt: stat.mtime.toISOString()
  };
}

/**
 * Extracts plain text content from a message, skipping tool_use, tool_result,
 * base64 images, thinking blocks, and IDE metadata messages.
 */
function extractTextContent(
  message: Record<string, unknown>,
  role: string
): string | null {
  const content = message['content'];
  if (typeof content === 'string') {
    return filterText(content, role);
  }

  if (!Array.isArray(content)) return null;

  const textParts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;

    // Only extract text blocks
    if (b['type'] !== 'text') continue;
    const text = b['text'] as string;
    if (!text) continue;

    textParts.push(text);
  }

  const combined = textParts.join('\n').trim();
  return filterText(combined, role);
}

/**
 * Filters out low-signal messages: IDE metadata, tool results, system reminders,
 * and very short messages.
 */
function filterText(text: string, role: string): string | null {
  if (!text || text.length < 10) return null;

  // Skip IDE-only messages (opened file, selection without user text)
  if (
    role === 'user' &&
    (text.startsWith('<ide_opened_file>') ||
      text.startsWith('<ide_selection>')) &&
    !text.includes('\n')
  ) {
    return null;
  }

  // Skip system reminders
  if (text.startsWith('<system-reminder>')) return null;

  // Skip tool result messages
  if (text.startsWith('[Request interrupted')) return null;

  return text;
}

/**
 * Computes conversation dynamics from the message sequence.
 * These are structural signals — not keyword matching.
 */
function computeDynamics(messages: ParsedMessage[]): SessionDigest['dynamics'] {
  const userMsgs = messages.filter((m) => m.role === 'user');

  // Turn count: number of user↔assistant exchanges
  let turnCount = 0;
  let lastRole = '';
  for (const m of messages) {
    if (m.role !== lastRole) {
      turnCount++;
      lastRole = m.role;
    }
  }

  // Correction density: ratio of short user messages following long assistant messages
  // Short user msg after long assistant msg = likely a correction/redirect
  let correctionLikeCount = 0;
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (
      curr.role === 'user' &&
      prev.role === 'assistant' &&
      curr.text.length < 100 &&
      prev.text.length > 200
    ) {
      correctionLikeCount++;
    }
  }
  const correctionDensity =
    userMsgs.length > 0 ? correctionLikeCount / userMsgs.length : 0;

  // Question count
  const questionCount = userMsgs.filter((m) => m.text.includes('?')).length;

  // Average user message length
  const avgUserMsgLength =
    userMsgs.length > 0
      ? userMsgs.reduce((sum, m) => sum + m.text.length, 0) / userMsgs.length
      : 0;

  // Escalation arc: frustration signals followed by explicit quality statements
  const frustrationPatterns =
    /\b(come on|this can't be|shouldn't be this hard|let's not hack|the right way|is this a solved|we got burned|stop doing)\b/i;
  const hasEscalationArc = userMsgs.some((m) =>
    frustrationPatterns.test(m.text)
  );

  // Topic shifts: simple proxy — count times consecutive user messages are very different
  let topicShifts = 0;
  for (let i = 1; i < userMsgs.length; i++) {
    const prev = userMsgs[i - 1].text.toLowerCase();
    const curr = userMsgs[i].text.toLowerCase();
    // Very rough: if fewer than 2 shared words (of 4+ chars), it's a topic shift
    const prevWords = new Set(prev.split(/\s+/).filter((w) => w.length >= 4));
    const currWords = curr.split(/\s+/).filter((w) => w.length >= 4);
    const shared = currWords.filter((w) => prevWords.has(w)).length;
    if (shared < 2 && prevWords.size > 2) topicShifts++;
  }

  return {
    turnCount,
    correctionDensity,
    questionCount,
    avgUserMsgLength,
    hasEscalationArc,
    topicShifts
  };
}
