import * as vscode from 'vscode';
import { CacheManager } from '../services/CacheManager';
import { LessVariable, LessMixin } from '../types/less';
import { isInLessCommentAtPosition, isLessContextAtPosition } from '../utils/LessDocumentContext';

export class LessDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
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
      return this.createLocation(cacheManager.findVariableByWorkspace(word, workspaceRoot));
    } else if (word.startsWith('.')) {
      return this.createLocation(cacheManager.findMixinByWorkspace(word, workspaceRoot));
    }

    return undefined;
  }

  private createLocation(item: (LessVariable | LessMixin) & { uri?: string } | undefined): vscode.Location | undefined {
    if (!item) {
      return undefined;
    }

    if (item.uri) {
      const uri = vscode.Uri.file(item.uri);
      const position = new vscode.Position(item.position.line, item.position.character);
      return new vscode.Location(uri, position);
    }
    
    return undefined;
  }
}
