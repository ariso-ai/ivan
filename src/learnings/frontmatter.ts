import {
  LearningsFrontmatter,
  LearningsScalar,
  LearningsValue,
  ParsedFrontmatterDocument
} from './types.js';

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/;

export function parseFrontmatterDocument(
  source: string
): ParsedFrontmatterDocument {
  const normalized = normalizeNewlines(source);
  const match = normalized.match(FRONTMATTER_PATTERN);

  if (!match) {
    throw new Error('Expected Markdown document with YAML frontmatter');
  }

  return {
    frontmatter: parseSimpleYaml(match[1]),
    body: match[2] ?? ''
  };
}

export function parseSimpleYaml(source: string): LearningsFrontmatter {
  const result: LearningsFrontmatter = {};
  const lines = normalizeNewlines(source).split('\n');

  for (let index = 0; index < lines.length; ) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      index += 1;
      continue;
    }

    if (/^\s/.test(rawLine)) {
      throw new Error(`Unsupported indentation at line ${index + 1}`);
    }

    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Expected "key: value" at line ${index + 1}`);
    }

    const key = rawLine.slice(0, separatorIndex).trim();
    const remainder = rawLine.slice(separatorIndex + 1).trim();

    if (!key) {
      throw new Error(`Missing key at line ${index + 1}`);
    }

    if (remainder === '') {
      const { items, nextIndex } = parseIndentedArray(lines, index + 1);
      result[key] = items.length > 0 ? items : '';
      index = nextIndex;
      continue;
    }

    result[key] = parseYamlValue(remainder);
    index += 1;
  }

  return result;
}

export function stringifySimpleYaml(
  record: Record<string, LearningsValue | undefined>
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }

      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatScalar(item)}`);
      }
      continue;
    }

    lines.push(`${key}: ${formatScalar(value)}`);
  }

  return `${lines.join('\n')}\n`;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function parseIndentedArray(
  lines: string[],
  startIndex: number
): { items: LearningsScalar[]; nextIndex: number } {
  const items: LearningsScalar[] = [];
  let nextIndex = startIndex;

  while (nextIndex < lines.length) {
    const rawLine = lines[nextIndex];
    const trimmed = rawLine.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      nextIndex += 1;
      continue;
    }

    const match = rawLine.match(/^\s*-\s+(.*)$/);
    if (!match) {
      break;
    }

    items.push(parseScalar(match[1].trim()));
    nextIndex += 1;
  }

  return { items, nextIndex };
}

function parseYamlValue(value: string): LearningsValue {
  if (value === '[]') {
    return [];
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    return inner.split(',').map((item) => parseScalar(item.trim()));
  }

  return parseScalar(value);
}

function parseScalar(value: string): LearningsScalar {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (value === 'null' || value === '~') {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return parseQuotedString(value);
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const integerPart = value.replace(/^-/, '').split('.')[0];
    if (integerPart.length <= 15 || value.includes('.')) {
      return Number(value);
    }
  }

  return value;
}

function parseQuotedString(value: string): string {
  if (value.startsWith('"')) {
    return JSON.parse(value);
  }

  return value.slice(1, -1).replace(/\\'/g, "'");
}

function formatScalar(value: LearningsScalar): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  return String(value);
}
