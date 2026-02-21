import * as path from 'path';
import * as vscode from 'vscode';
import { LessImportService } from './LessImportService';
import { LessSettingsService } from './LessSettingsService';
import { WorkspaceService } from './WorkspaceService';

export class LessOnboardingService {
  private static promptedWorkspaceRoots: Set<string> = new Set();
  private static isPrompting = false;

  public static async maybePromptForLessFiles(document?: vscode.TextDocument): Promise<void> {
    const workspaceFolder = this.resolveWorkspaceFolder(document);
    if (!workspaceFolder) {
      return;
    }

    const workspaceRoot = path.resolve(workspaceFolder.uri.fsPath);
    if (this.promptedWorkspaceRoots.has(workspaceRoot) || this.isPrompting) {
      return;
    }

    if (!WorkspaceService.documentUsesLess(document)) {
      return;
    }

    const configured = LessSettingsService.getConfiguredLessFiles(workspaceFolder.uri);
    if (configured.length > 0) {
      return;
    }

    if (!LessSettingsService.isNoticeEnabled(workspaceFolder.uri)) {
      return;
    }

    this.isPrompting = true;

    try {
      const action = await vscode.window.showInformationMessage(
        'Vue Less Helper: 未检测到 lessFiles 配置，是否现在选择全局 less 文件？',
        '选择文件',
        '不再提示'
      );

      if (action === '选择文件') {
        const saved = await this.selectFilesAndSave(workspaceFolder);
        if (saved) {
          this.promptedWorkspaceRoots.add(workspaceRoot);
        }
        return;
      }
      if (action === '不再提示') {
        await LessSettingsService.setNoticeEnabled(workspaceFolder.uri, false);
        this.promptedWorkspaceRoots.add(workspaceRoot);
        vscode.window.showInformationMessage(
          'Vue Less Helper: 已设置不再提示。可在 .vscode/settings.json 中修改 vueLessHelper.notice。'
        );
      }
    } finally {
      this.isPrompting = false;
    }
  }

  private static resolveWorkspaceFolder(document?: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
    if (document) {
      return vscode.workspace.getWorkspaceFolder(document.uri) || vscode.workspace.workspaceFolders?.[0];
    }
    return vscode.workspace.workspaceFolders?.[0];
  }

  private static async selectFilesAndSave(workspaceFolder: vscode.WorkspaceFolder): Promise<boolean> {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { Less: ['less'] }
    });

    if (!picks || picks.length === 0) {
      return false;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const aliasConfig = LessImportService.getAliasConfig(workspaceRoot);
    const lessFiles = picks
      .map(item => this.toConfiguredPath(item.fsPath, workspaceRoot, aliasConfig))
      .filter(Boolean);

    if (lessFiles.length === 0) {
      return false;
    }

    await LessSettingsService.saveLessFiles(workspaceFolder.uri, lessFiles);
    vscode.window.showInformationMessage('Vue Less Helper: lessFiles 已保存到当前工作区设置。');
    return true;
  }

  private static toConfiguredPath(
    absPath: string,
    workspaceRoot: string,
    aliasConfig: Record<string, string>
  ): string {
    const importPath = LessImportService.buildImportPath(path.resolve(absPath), workspaceRoot);
    if (!importPath.startsWith('./')) {
      return importPath;
    }

    const normalized = importPath.slice(2);
    if (!normalized) {
      return importPath;
    }

    for (const [alias, aliasRoot] of Object.entries(aliasConfig)) {
      const aliasAbs = path.resolve(aliasRoot);
      const targetAbs = path.resolve(absPath);
      if (targetAbs === aliasAbs || targetAbs.startsWith(aliasAbs + path.sep)) {
        const relativePart = path.relative(aliasAbs, targetAbs).replace(/\\/g, '/');
        return relativePart ? `${alias}/${relativePart}` : alias;
      }
    }

    return normalized;
  }
}
