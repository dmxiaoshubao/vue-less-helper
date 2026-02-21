import * as vscode from 'vscode';

export function isLessContextAtPosition(document: vscode.TextDocument, position: vscode.Position): boolean {
  return !!resolveLessContextSlice(document, position);
}

export function isInsideLessStyleTag(document: vscode.TextDocument, position: vscode.Position): boolean {
  if (document.languageId !== 'vue') {
    return false;
  }
  return !!resolveLessContextSlice(document, position);
}

export function isInLessCommentAtPosition(document: vscode.TextDocument, position: vscode.Position): boolean {
  const context = resolveLessContextSlice(document, position);
  if (!context) {
    return false;
  }

  const textBeforePosition = context.text;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < textBeforePosition.length; i++) {
    const ch = textBeforePosition[i];
    const next = textBeforePosition[i + 1];
    const prev = i > 0 ? textBeforePosition[i - 1] : ' ';

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '\'') {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
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

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '/' && /[\s{(;,]/.test(prev)) {
      inLineComment = true;
      i++;
      continue;
    }
  }

  return inLineComment || inBlockComment;
}

function resolveLessContextSlice(
  document: vscode.TextDocument,
  position: vscode.Position
): { text: string } | null {
  if (document.languageId !== 'less' && document.languageId !== 'vue') {
    return null;
  }

  const fullText = document.getText();
  const positionOffset = getOffsetAt(document, position, fullText);
  if (positionOffset < 0) {
    return null;
  }

  if (document.languageId === 'less') {
    return { text: fullText.slice(0, positionOffset) };
  }

  const textBefore = fullText.slice(0, positionOffset);
  const styleStartIndex = textBefore.lastIndexOf('<style');
  const styleEndIndex = textBefore.lastIndexOf('</style>');
  if (styleStartIndex <= styleEndIndex) {
    return null;
  }

  const openTagEnd = fullText.indexOf('>', styleStartIndex);
  if (openTagEnd === -1 || openTagEnd >= positionOffset) {
    return null;
  }

  const openTag = fullText.slice(styleStartIndex, openTagEnd + 1);
  if (!/<style\b[^>]*\blang=["']less["'][^>]*>/i.test(openTag)) {
    return null;
  }

  return { text: fullText.slice(openTagEnd + 1, positionOffset) };
}

function getOffsetAt(document: vscode.TextDocument, position: vscode.Position, fullText: string): number {
  const withOffsetAt = document as vscode.TextDocument & { offsetAt?(position: vscode.Position): number };
  if (typeof withOffsetAt.offsetAt === 'function') {
    return withOffsetAt.offsetAt(position);
  }

  if (position.line < 0 || position.character < 0) {
    return -1;
  }

  let line = 0;
  let index = 0;
  while (line < position.line && index < fullText.length) {
    const ch = fullText[index];
    index++;
    if (ch === '\n') {
      line++;
    }
  }

  return Math.min(index + position.character, fullText.length);
}
