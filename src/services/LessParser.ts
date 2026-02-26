import { LessVariable, LessMixin } from '../types/less';

export class LessParser {
  /**
   * 移除内容中的单行 // 和多行 /* *\/ 注释
   * @param content less文本
   */
  public static removeComments(content: string): string {
    let result = '';
    let i = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    while (i < content.length) {
      const ch = content[i];
      const next = content[i + 1];
      const prev = i > 0 ? content[i - 1] : ' ';

      if (inLineComment) {
        if (ch === '\n' || ch === '\r') {
          inLineComment = false;
          result += ch;
        } else {
          result += ' ';
        }
        i++;
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          result += '  ';
          i += 2;
          continue;
        }
        result += ch === '\n' || ch === '\r' ? ch : ' ';
        i++;
        continue;
      }

      if (inSingleQuote) {
        result += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '\'') {
          inSingleQuote = false;
        }
        i++;
        continue;
      }

      if (inDoubleQuote) {
        result += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inDoubleQuote = false;
        }
        i++;
        continue;
      }

      if (ch === '\'') {
        inSingleQuote = true;
        result += ch;
        i++;
        continue;
      }

      if (ch === '"') {
        inDoubleQuote = true;
        result += ch;
        i++;
        continue;
      }

      if (ch === '/' && next === '*') {
        inBlockComment = true;
        result += '  ';
        i += 2;
        continue;
      }

      if (ch === '/' && next === '/' && /[\s{(;,]/.test(prev)) {
        inLineComment = true;
        result += '  ';
        i += 2;
        continue;
      }

      result += ch;
      i++;
    }

    return result;
  }

  /**
   * 解析出所有的 Less 变量
   * @param content less 内容
   * @returns 变量列表
   */
  public static extractVariables(content: string): LessVariable[] {
    const variables: LessVariable[] = [];
    const cleanContent = this.removeComments(content);
    const lines = cleanContent.split('\n');

    const varRegex = /(@[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

    lines.forEach((line, index) => {
      let match;
      while ((match = varRegex.exec(line)) !== null) {
        variables.push({
          name: match[1],
          value: match[2].trim(),
          position: { line: index, character: match.index }
        });
      }
    });

    return variables;
  }

  /**
   * 解析出所有的 Less Mixin
   * @param content less 内容
   * @returns Mixin列表
   */
  public static extractMixins(content: string): LessMixin[] {
    const mixins: LessMixin[] = [];
    const cleanContent = this.removeComments(content);
    let i = 0;
    while (i < cleanContent.length) {
      const ch = cleanContent[i];
      if (ch !== '.' || !this.isMixinStartBoundary(cleanContent, i - 1)) {
        i++;
        continue;
      }

      let cursor = i + 1;
      while (cursor < cleanContent.length && /[a-zA-Z0-9_-]/.test(cleanContent[cursor])) {
        cursor++;
      }
      if (cursor === i + 1) {
        i++;
        continue;
      }

      const mixinName = cleanContent.slice(i, cursor);
      cursor = this.skipSpaces(cleanContent, cursor);

      let params = '';
      if (cleanContent[cursor] === '(') {
        const paramEnd = this.findMatchingCloseParenIndex(cleanContent, cursor);
        if (paramEnd < 0) {
          i++;
          continue;
        }
        params = cleanContent.slice(cursor + 1, paramEnd).trim();
        cursor = this.skipSpaces(cleanContent, paramEnd + 1);
      }

      if (cleanContent[cursor] !== '{') {
        i++;
        continue;
      }

      const closeBraceIndex = this.findMatchingCloseBraceIndex(cleanContent, cursor);
      const bodyEnd = closeBraceIndex >= 0 ? closeBraceIndex + 1 : cleanContent.length;
      const preMatch = cleanContent.substring(0, i);
      const line = preMatch.split('\n').length - 1;
      mixins.push({
        name: mixinName,
        params,
        body: cleanContent.slice(i, bodyEnd),
        position: { line, character: 0 }
      });

      i = bodyEnd;
    }

    return mixins;
  }

  private static isMixinStartBoundary(content: string, index: number): boolean {
    if (index < 0) {
      return true;
    }
    return /[\s;{}(),>+~]/.test(content[index]);
  }

  private static skipSpaces(content: string, from: number): number {
    let i = from;
    while (i < content.length && /\s/.test(content[i])) {
      i++;
    }
    return i;
  }

  private static findMatchingCloseParenIndex(content: string, openParenIndex: number): number {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = openParenIndex; i < content.length; i++) {
      const ch = content[i];
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
      if (ch === '(') {
        depth++;
        continue;
      }
      if (ch === ')') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  private static findMatchingCloseBraceIndex(content: string, openBraceIndex: number): number {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = openBraceIndex; i < content.length; i++) {
      const ch = content[i];
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
}
