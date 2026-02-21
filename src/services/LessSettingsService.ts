import * as vscode from 'vscode';

function normalizeLessFileList(list: string[] | undefined): string[] {
  if (!list || !Array.isArray(list)) {
    return [];
  }
  const normalized = list
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export class LessSettingsService {
  public static getConfiguredLessFiles(scope?: vscode.ConfigurationScope): string[] {
    const nextFiles = normalizeLessFileList(
      vscode.workspace.getConfiguration('vueLessHelper', scope).get<string[]>('lessFiles')
    );
    if (nextFiles.length > 0) {
      return nextFiles;
    }

    return normalizeLessFileList(
      vscode.workspace.getConfiguration(undefined, scope).get<string[]>('less.files')
    );
  }

  public static isNoticeEnabled(scope?: vscode.ConfigurationScope): boolean {
    const usingNext = this.hasExplicitSetting('vueLessHelper', 'notice', scope);
    if (usingNext) {
      const notice = vscode.workspace.getConfiguration('vueLessHelper', scope).get<boolean>('notice');
      return notice !== false;
    }

    const hasLegacyNotice = this.hasExplicitSetting(undefined, 'less.notice', scope);
    const hasLegacySuppress = this.hasExplicitSetting(undefined, 'less.suppressNotice', scope);
    if (hasLegacyNotice || hasLegacySuppress) {
      const legacyNotice = vscode.workspace.getConfiguration(undefined, scope).get<boolean>('less.notice');
      const legacySuppress = vscode.workspace.getConfiguration(undefined, scope).get<boolean>('less.suppressNotice');
      return legacyNotice !== false && legacySuppress !== true;
    }

    const notice = vscode.workspace.getConfiguration('vueLessHelper', scope).get<boolean>('notice');
    return notice !== false;
  }

  public static async saveLessFiles(scope: vscode.ConfigurationScope, lessFiles: string[]): Promise<void> {
    const normalized = normalizeLessFileList(lessFiles);
    const settings = vscode.workspace.getConfiguration('vueLessHelper', scope);
    await settings.update('lessFiles', normalized, vscode.ConfigurationTarget.WorkspaceFolder);
  }

  public static async setNoticeEnabled(scope: vscode.ConfigurationScope, enabled: boolean): Promise<void> {
    const settings = vscode.workspace.getConfiguration('vueLessHelper', scope);
    await settings.update('notice', enabled, vscode.ConfigurationTarget.WorkspaceFolder);
  }

  private static hasExplicitSetting(
    section: string | undefined,
    key: string,
    scope?: vscode.ConfigurationScope
  ): boolean {
    const config = vscode.workspace.getConfiguration(section, scope);
    const inspected = config.inspect<unknown>(key);
    if (!inspected) {
      return false;
    }
    return (
      inspected.workspaceFolderValue !== undefined ||
      inspected.workspaceValue !== undefined ||
      inspected.globalValue !== undefined
    );
  }
}
