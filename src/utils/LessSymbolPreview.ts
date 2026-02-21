export const DEFAULT_MAX_BODY_LINES = 5;

export function formatVariablePreview(name: string, value: string): string {
  return `${name}: ${value};`;
}

export function extractMixinSignature(definition: string): string {
  const parsed = parseMixinDefinition(definition);
  if (parsed) {
    return parsed.header;
  }
  const match = definition.match(/(\.[a-zA-Z0-9_-]+)/);
  return match ? match[1] : definition;
}

export function formatMixinPreview(definition: string, maxLines: number = DEFAULT_MAX_BODY_LINES): string {
  const parsed = parseMixinDefinition(definition);
  if (!parsed) {
    return definition;
  }

  const header = parsed.header;
  const innerContent = parsed.body.trim();
  if (!innerContent) {
    return `${header} {}`;
  }

  let lines = splitBodyLines(innerContent).map(normalizeBodyLine).filter(Boolean);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines.push('...');
  }

  const formattedLines = lines.map(line => (line === '...' ? '  ...' : `  ${line}`));
  return `${header} {\n${formattedLines.join('\n')}\n}`;
}

function splitBodyLines(content: string): string[] {
  if (content.includes('\n')) {
    return content.split('\n').map(line => line.trim()).filter(Boolean);
  }
  return content
    .split(';')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `${line};`);
}

function normalizeBodyLine(line: string): string {
  if (line === '...') {
    return line;
  }
  if (/[\{\}]$/.test(line) || /;$/.test(line)) {
    return line;
  }
  return `${line};`;
}

function parseMixinDefinition(definition: string): { header: string; body: string } | null {
  const openBraceIndex = findOpenBraceIndex(definition);
  if (openBraceIndex < 0) {
    return null;
  }

  const closeBraceIndex = findMatchingCloseBraceIndex(definition, openBraceIndex);

  const header = definition.slice(0, openBraceIndex).trim();
  if (!header.startsWith('.')) {
    return null;
  }

  const bodyEnd = closeBraceIndex >= 0 ? closeBraceIndex : definition.length;
  const body = definition.slice(openBraceIndex + 1, bodyEnd);
  return { header, body };
}

function findOpenBraceIndex(input: string): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inSingleQuote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '\'') inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inDoubleQuote = false;
      continue;
    }
    if (ch === '\'') {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === '{') {
      return i;
    }
  }
  return -1;
}

function findMatchingCloseBraceIndex(input: string, openBraceIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = openBraceIndex; i < input.length; i++) {
    const ch = input[i];
    if (inSingleQuote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '\'') inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inDoubleQuote = false;
      continue;
    }
    if (ch === '\'') {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}
