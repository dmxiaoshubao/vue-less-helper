import * as vscode from 'vscode';
import { CacheManager } from '../services/CacheManager';
import { formatMixinPreview, formatVariablePreview } from '../utils/LessSymbolPreview';
import { isInLessCommentAtPosition, isLessContextAtPosition } from '../utils/LessDocumentContext';

export class LessHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    if (token?.isCancellationRequested) {
      return undefined;
    }
    if (!isLessContextAtPosition(document, position)) {
      return undefined;
    }

    const range = document.getWordRangeAtPosition(position, /[@\.][a-zA-Z0-9_-]+/);
    if (!range) {
      return undefined;
    }
    if (isInLessCommentAtPosition(document, range.start)) {
      return undefined;
    }

    const word = document.getText(range);
    const cacheManager = CacheManager.getInstance();
    const workspaceRoot = document.uri ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath : undefined;

    if (word.startsWith('@')) {
      const matchedVar = cacheManager.findVariableByWorkspace(word, workspaceRoot);
      if (matchedVar) {
        const md = new vscode.MarkdownString();
        md.appendCodeblock(formatVariablePreview(matchedVar.name, matchedVar.value), 'less');
        return new vscode.Hover(md, range);
      }
    } else if (word.startsWith('.')) {
      const matchedMixin = cacheManager.findMixinByWorkspace(word, workspaceRoot);
      if (matchedMixin) {
        const md = new vscode.MarkdownString();
        md.appendCodeblock(formatMixinPreview(matchedMixin.body), 'less');
        return new vscode.Hover(md, range);
      }
    }

    return undefined;
  }
}
