export const DEFAULT_MAX_BODY_LINES = 5;
const DEFAULT_MAX_COLOR_SWATCHES = 4;

const HEX_COLOR_REGEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FUNCTION_COLOR_REGEX = /\b(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.%\s,]+\)/gi;

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
  const innerContent = trimOuterBlankLines(parsed.body);
  if (!innerContent) {
    return `${header} {}`;
  }

  let lines = splitBodyLines(innerContent).map(normalizeBodyLine).filter(Boolean);
  lines = normalizePreviewIndentation(lines);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines.push('...');
  }

  const formattedLines = lines.map(line => (line === '...' ? '  ...' : line));
  return `${header} {\n${formattedLines.join('\n')}\n}`;
}

export function formatPreviewWithInlineColorSwatches(previewCode: string, colorSource: string): { markdown: string; supportHtml: boolean } {
  const codeBlock = `\`\`\`less\n${previewCode}\n\`\`\``;
  const colors = extractPreviewColors(colorSource);
  if (!colors.length) {
    return {
      markdown: codeBlock,
      supportHtml: false
    };
  }

  const colorLineAnnotations = buildColorLineAnnotations(previewCode, colorSource, colors);
  if (!colorLineAnnotations.length) {
    return {
      markdown: codeBlock,
      supportHtml: false
    };
  }

  return {
    markdown: `${codeBlock}\n${colorLineAnnotations.join('<br>')}`,
    supportHtml: true
  };
}

function buildColorLineAnnotations(previewCode: string, colorSource: string, colors: string[]): string[] {
  if (!previewCode || !colors.length) {
    return [];
  }

  const parsedMixin = parseMixinDefinition(colorSource);
  if (parsedMixin) {
    const mixinRows = extractTopLevelDeclarationsFromMixin(colorSource)
      .map(declaration => renderColorDeclarationRow(declaration.name, declaration.value, '', colors))
      .filter((row): row is string => !!row);
    return mixinRows;
  }

  const rows: string[] = [];
  const lines = previewCode.split('\n');
  for (const line of lines) {
    const rendered = renderColorDeclarationLine(line, colors);
    if (rendered) {
      rows.push(rendered);
    }
  }
  return rows;
}

function renderColorDeclarationLine(line: string, colors: string[]): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === '...' || trimmed === '{' || trimmed === '}') {
    return null;
  }

  const declarationMatch = line.match(/^(\s*)([a-zA-Z-]+|@[a-zA-Z0-9_-]+)(\s*:\s*)(.+?)(;?)$/);
  if (!declarationMatch) {
    return null;
  }

  const [, indent, name, colonPart, valuePart, semicolon] = declarationMatch;
  return renderColorDeclarationRow(name, valuePart, indent, colors, colonPart, semicolon);
}

function renderColorDeclarationRow(
  name: string,
  valuePart: string,
  indent: string,
  colors: string[],
  colonPart: string = ': ',
  semicolon: string = ';'
): string | null {
  const sourceValue = valuePart.trim();
  let replacedValue = escapeHtmlText(sourceValue);
  let hasRenderableColor = false;

  for (const color of colors) {
    const matcher = new RegExp(escapeRegExp(color), 'gi');
    if (!matcher.test(sourceValue)) {
      continue;
    }
    const swatchColor = toHoverSwatchHex(color) || color;
    if (!isSafeColorToken(swatchColor)) {
      continue;
    }

    const escapedSource = escapeHtmlText(color.trim());
    const escapedSwatchColor = escapeHtmlAttribute(swatchColor);
    replacedValue = replacedValue.replace(
      new RegExp(escapeRegExp(escapedSource), 'g'),
      `<span style="color:${escapedSwatchColor};">■</span>&nbsp;<span style="color:var(--vscode-debugTokenExpression-string, var(--vscode-terminal-ansiYellow));">${escapedSource}</span>`
    );
    hasRenderableColor = true;
  }

  if (!hasRenderableColor) {
    return null;
  }

  const htmlIndent = '&nbsp;'.repeat(indent.trimEnd().length);
  return [
    '<span style="font-family:var(--vscode-editor-font-family);">',
    htmlIndent,
    `<span style="color:var(--vscode-symbolIcon-propertyForeground, var(--vscode-editor-foreground));">${escapeHtmlText(name)}</span>`,
    `<span style="color:var(--vscode-editor-foreground);">${escapeHtmlText(colonPart)}</span>`,
    replacedValue,
    semicolon ? escapeHtmlText(semicolon) : '',
    '</span>'
  ].join('');
}

export function extractPreviewColors(source: string, maxColors: number = DEFAULT_MAX_COLOR_SWATCHES): string[] {
  if (!source) {
    return [];
  }

  const candidateColors = [
    ...source.match(HEX_COLOR_REGEX) || [],
    ...source.match(FUNCTION_COLOR_REGEX) || []
  ];
  if (!candidateColors.length) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawColor of candidateColors) {
    const color = rawColor.trim();
    if (!isSafeColorToken(color)) {
      continue;
    }
    const key = color.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(color);
    if (result.length >= maxColors) {
      break;
    }
  }

  return result;
}

function extractTopLevelDeclarationsFromMixin(source: string): Array<{ name: string; value: string }> {
  const parsed = parseMixinDefinition(source);
  if (!parsed) {
    return [];
  }
  const body = parsed.body;
  const declarations: Array<{ name: string; value: string } | null> = [];
  const latestIndexByKey = new Map<string, number>();

  let depth = 0;
  let start = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
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
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        start = i + 1;
      }
      continue;
    }
    if (ch === ';' && depth === 0) {
      const statement = body.slice(start, i).trim();
      start = i + 1;
      const declaration = parseDeclarationStatement(statement);
      if (!declaration) {
        continue;
      }
      const key = declaration.name.toLowerCase();
      const prevIndex = latestIndexByKey.get(key);
      if (typeof prevIndex === 'number') {
        declarations[prevIndex] = null;
      }
      latestIndexByKey.set(key, declarations.length);
      declarations.push(declaration);
    }
  }

  return declarations.filter((entry): entry is { name: string; value: string } => !!entry);
}

function parseDeclarationStatement(statement: string): { name: string; value: string } | null {
  const match = statement.match(/^([@a-zA-Z-][a-zA-Z0-9_-]*)\s*:\s*(.+)$/);
  if (!match) {
    return null;
  }
  return {
    name: match[1],
    value: match[2].trim()
  };
}

function splitBodyLines(content: string): string[] {
  if (content.includes('\n')) {
    return content
      .split('\n')
      .map(line => line.replace(/\s+$/g, ''))
      .filter(line => line.trim().length > 0);
  }
  return content
    .split(';')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `${line};`);
}

function trimOuterBlankLines(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }

  return lines.join('\n');
}

function normalizePreviewIndentation(lines: string[]): string[] {
  const meaningfulLines = lines.filter(line => line !== '...' && line.trim().length > 0);
  if (meaningfulLines.length === 0) {
    return lines;
  }

  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of meaningfulLines) {
    const indent = getLeadingIndentWidth(line);
    minIndent = Math.min(minIndent, indent);
  }
  if (!Number.isFinite(minIndent)) {
    minIndent = 0;
  }

  return lines.map(line => {
    if (line === '...') {
      return line;
    }
    const content = line.trimStart();
    const indent = getLeadingIndentWidth(line);
    const relativeIndent = Math.max(0, indent - minIndent);
    return `${' '.repeat(2 + relativeIndent)}${content}`;
  });
}

function getLeadingIndentWidth(line: string): number {
  const match = line.match(/^[\t ]*/);
  const raw = match ? match[0] : '';
  let width = 0;
  for (const ch of raw) {
    width += ch === '\t' ? 2 : 1;
  }
  return width;
}

function normalizeBodyLine(line: string): string {
  if (line === '...') {
    return line;
  }
  const trimmedEnd = line.replace(/\s+$/g, '');
  if (/[\{\}]$/.test(trimmedEnd) || /;$/.test(trimmedEnd)) {
    return line;
  }
  return `${trimmedEnd};`;
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

function isSafeColorToken(value: string): boolean {
  return /^[#(),.%\s0-9a-zA-Z+-]+$/.test(value);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toHoverSwatchHex(color: string): string | null {
  const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    const raw = hex[1];
    if (raw.length === 3 || raw.length === 4) {
      return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    }
    return `#${raw.slice(0, 6)}`;
  }

  const rgb = parseRgbLikeColor(color);
  if (rgb) {
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
  }
  return null;
}

function parseRgbLikeColor(input: string): { r: number; g: number; b: number } | null {
  const rgbMatch = input.match(/^rgba?\((.+)\)$/i);
  if (!rgbMatch) {
    return null;
  }
  const segments = rgbMatch[1].split(',').map(part => part.trim());
  if (segments.length < 3) {
    return null;
  }
  const r = parseRgbChannel(segments[0]);
  const g = parseRgbChannel(segments[1]);
  const b = parseRgbChannel(segments[2]);
  if (r === null || g === null || b === null) {
    return null;
  }
  return { r, g, b };
}

function parseRgbChannel(value: string): number | null {
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value.slice(0, -1));
    if (!Number.isFinite(percent)) {
      return null;
    }
    return clampRgb(Math.round((percent / 100) * 255));
  }
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return clampRgb(Math.round(numeric));
}

function clampRgb(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
