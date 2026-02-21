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
    const lines = cleanContent.split('\n');

    // 修改正则：使其括号以及参数匹配可选，同时适配 `.box` 或 `.box( ... )`
    const mixinRegex = /(\.[a-zA-Z0-9_-]+)(?:\s*\((.*?)\))?\s*\{([^]*?)\}/g;

    const contentStr = lines.join('\n');
    let match;
    while ((match = mixinRegex.exec(contentStr)) !== null) {
      // 计算行号大概位置
      const preMatch = contentStr.substring(0, match.index);
      const line = preMatch.split('\n').length - 1;
      
      mixins.push({
        name: match[1],
        params: match[2] ? match[2].trim() : '',
        body: match[0], // 获取完整的 .box(...) { ... } 用作提示呈现
        position: { line, character: 0 }
      });
    }

    return mixins;
  }
}
