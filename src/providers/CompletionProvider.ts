import * as vscode from 'vscode';
import { CacheManager } from '../services/CacheManager';
import {
  formatPreviewWithInlineColorSwatches,
  formatMixinPreview,
  formatVariablePreview
} from '../utils/LessSymbolPreview';
import { isInLessCommentAtPosition, isLessContextAtPosition } from '../utils/LessDocumentContext';

export class LessCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    if (token?.isCancellationRequested) {
      return undefined;
    }
    if (!isLessContextAtPosition(document, position)) {
      return undefined;
    }
    if (isInLessCommentAtPosition(document, position)) {
      return undefined;
    }

    const fullLineText = document.lineAt(position).text;
    const linePrefix = fullLineText.substring(0, position.character);
    const rightText = fullLineText.substring(position.character);

    const isVariableTrigger = /(?:^|[\s,{;:(])@[\w-]*$/.test(linePrefix); 
    const isPropValueTrigger = /:\s*([\w-]*)$/.test(linePrefix);
    const isMixinTrigger = /(?:^|[\s,{;:(])\.[\w.-]*$/.test(linePrefix);
    
    // 如果没有命中任一规则，直接返回
    if (!isVariableTrigger && !isPropValueTrigger && !isMixinTrigger) {
      return undefined;
    }

    const items: vscode.CompletionItem[] = [];
    const cacheManager = CacheManager.getInstance();
    const workspaceRoot = document.uri ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath : undefined;

    if (isVariableTrigger || isPropValueTrigger) {
      const atMatch = linePrefix.match(/@[\w-]*$/);
      const propMatch = linePrefix.match(/:\s*([\w-]*)$/);
      
      const isVar = !!atMatch;
      const isProp = !!propMatch && !isVar;

      let replaceStart = 0;
      if (isVar) {
        replaceStart = position.character - atMatch![0].length;
      } else if (isProp) {
        replaceStart = position.character - propMatch![1].length;
      }

      const rightIdentifier = (rightText.match(/^[\w-]*/) || [''])[0];
      const suffixReplaceLength = this.consumeUntilBoundary(rightText, rightIdentifier.length);

      const replaceEnd = position.character + suffixReplaceLength;
      const replaceRange = new vscode.Range(
        new vscode.Position(position.line, replaceStart), 
        new vscode.Position(position.line, replaceEnd)
      );

      const afterReplaceText = rightText.slice(suffixReplaceLength);
      const needSemicolon = this.shouldAppendSemicolon(afterReplaceText) && !this.hasLeadingSemicolon(afterReplaceText);

      const vars = cacheManager.getUniqueVariablesByWorkspace(workspaceRoot);
      for (const v of vars) {
        if (token?.isCancellationRequested) {
          return undefined;
        }
        const label = v.name; // e.g. '@primary-color'
        const insertTextStr = needSemicolon ? `${label};` : label;

        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Variable);
        item.filterText = label;
        item.insertText = insertTextStr;
        item.range = replaceRange;
        
        item.documentation = this.createPreviewMarkdown(
          formatVariablePreview(v.name, v.value),
          v.value
        );
        if (this.isColor(v.value)) {
          item.kind = vscode.CompletionItemKind.Color;
        }
        item.command = {
          command: 'vueLessHelper.autoImport',
          title: 'Auto Import',
          arguments: [v.name]
        };

        items.push(item);
      }
    } 
    
    if (isMixinTrigger) {
      const dotMatch = linePrefix.match(/\.([\w.-]*)$/);
      const replaceStart = position.character - dotMatch![0].length;
      const rightIdentifier = (rightText.match(/^[\w.-]*/) || [''])[0];
      let suffixReplaceLength = this.consumeUntilBoundary(rightText, rightIdentifier.length);
      
      const normalizedRightText = rightText.slice(suffixReplaceLength);
      const methodCallInfo = this.getLeadingMethodCallInfo(normalizedRightText);

      let existingArgs = '';
      if (methodCallInfo) {
        existingArgs = methodCallInfo.args;
        suffixReplaceLength += methodCallInfo.full.length;
        // 如果后面还有多余空格、字符，再次探测直到真正合法边界
        const afterMethodCallText = rightText.slice(suffixReplaceLength);
        suffixReplaceLength += this.consumeUntilBoundary(afterMethodCallText, 0);
      }

      const replaceEnd = position.character + suffixReplaceLength;
      const replaceRange = new vscode.Range(
        new vscode.Position(position.line, replaceStart), 
        new vscode.Position(position.line, replaceEnd)
      );
      
      const afterReplaceText = rightText.slice(suffixReplaceLength);
      const needSemicolon = this.shouldAppendSemicolon(afterReplaceText) && !this.hasLeadingSemicolon(afterReplaceText);

      const mixins = cacheManager.getUniqueMixinsByWorkspace(workspaceRoot);
      for (const m of mixins) {
        if (token?.isCancellationRequested) {
          return undefined;
        }
        const label = m.name; // e.g. '.border-radius'
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
        item.filterText = label;
        item.range = replaceRange;
        item.documentation = this.createPreviewMarkdown(
          formatMixinPreview(m.body),
          m.body
        );
        
        const hasParams = m.params && m.params.trim().length > 0;
        let insertTextStr = '';

        if (hasParams) {
           if (methodCallInfo && existingArgs.trim().length > 0) {
               insertTextStr = needSemicolon ? `${label}(${existingArgs});` : `${label}(${existingArgs})`;
           } else {
               insertTextStr = needSemicolon ? `${label}($1);` : `${label}($1)`;
           }
        } else {
           insertTextStr = needSemicolon ? `${label};` : `${label}`;
        }

        item.insertText = new vscode.SnippetString(insertTextStr);
        item.command = {
          command: 'vueLessHelper.autoImport',
          title: 'Auto Import',
          arguments: [m.name]
        };
        items.push(item);
      }
    }

    return items;
  }

  private isColor(value: string): boolean {
    return /^#([0-9a-fA-F]{3}){1,2}$/.test(value) || /^(rgb|hsl)a?\(/.test(value);
  }

  private createPreviewMarkdown(previewCode: string, colorSource: string = previewCode): vscode.MarkdownString {
    const rendered = formatPreviewWithInlineColorSwatches(previewCode, colorSource);
    const md = new vscode.MarkdownString(rendered.markdown);
    if (rendered.supportHtml) {
      md.supportHtml = true;
    }
    return md;
  }

  private shouldAppendSemicolon(rightText: string): boolean {
    const trimmed = rightText.trimStart();
    if (!trimmed) {
      return true;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      return true;
    }
    return false;
  }

  private hasLeadingSemicolon(rightText: string): boolean {
    return /^\s*;/.test(rightText);
  }

  private getLeadingMethodCallInfo(rightText: string): { full: string; args: string; hasSemicolon: boolean } | null {
    let i = 0;
    while (i < rightText.length && /\s/.test(rightText[i])) {
      i++;
    }

    if (rightText[i] !== '(') {
      return null;
    }

    const openIndex = i;
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (; i < rightText.length; i++) {
      const ch = rightText[i];

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

      if (ch === '\'') { inSingleQuote = true; continue; }
      if (ch === '"') { inDoubleQuote = true; continue; }

      if (ch === '(') { depth++; continue; }
      if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }

    if (depth !== 0 || i >= rightText.length) {
      return null;
    }

    const closeIndex = i;
    const args = rightText.slice(openIndex + 1, closeIndex);
    const cursorAfterCall = closeIndex + 1;
    let semicolonProbeIndex = cursorAfterCall;
    while (semicolonProbeIndex < rightText.length && /\s/.test(rightText[semicolonProbeIndex])) {
      semicolonProbeIndex++;
    }
    const hasSemicolon = rightText[semicolonProbeIndex] === ';';
    let endIndex = cursorAfterCall;
    if (hasSemicolon) {
      endIndex = semicolonProbeIndex + 1;
    }

    return {
      full: rightText.slice(0, endIndex),
      args,
      hasSemicolon,
    };
  }

  private consumeUntilBoundary(rightText: string, startAfterMatch: number): number {
    // 这个方法负责判断，在当前已经知道的合法前缀之后（比如 'or' 已经跟在光标右侧）
    // 是否还有诸如 '   us' 或者 'er' 这样因为输入法空格断开的残余有效字符，
    // 直到遇到明确的停顿（分号、括号、注释、换行）为止截取它们。
    let i = startAfterMatch;
    // 如果紧接着是括号，那是函数调用的开头，不能吞噬
    if (i < rightText.length && rightText[i] === '(') {
      return i;
    }
    
    // 继续往后吞咽空白和属于标识符的字母
    while (i < rightText.length) {
      const ch = rightText[i];
      // 如果遇到明确表示语句结束或结构开始的字符，停止吞咽
      if (ch === ';' || ch === '{' || ch === '}' || ch === '(' || ch === ')') {
        break;
      }
      // 如果遇到注释，也必须完整保留
      if (ch === '/' && i + 1 < rightText.length && (rightText[i+1] === '/' || rightText[i+1] === '*')) {
        break;
      }
      // 对于剩下的字符（包括空格字母横杠等），都将被作为垃圾文字被覆盖掉
      i++;
    }

    // 回退尾部的空格，让我们不要吞噬多余的前导空白（例如分号或注释前面的有效格式空格）
    while (i > startAfterMatch && /\s/.test(rightText[i - 1])) {
      i--;
    }

    return i;
  }
}
