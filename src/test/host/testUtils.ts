import * as path from 'path';
import * as vscode from 'vscode';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function updateWorkspaceFolderSettingWithRetry(
  scopeUri: vscode.Uri,
  key: string,
  value: unknown,
  maxAttempts = 6
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const folderUri = await waitForWorkspaceFolderUri(scopeUri, 8, 80);
    if (!folderUri) {
      if (attempt >= maxAttempts) {
        throw new Error(`Workspace folder is not ready for scope: ${scopeUri.fsPath}`);
      }
      await sleep(120 * attempt);
      continue;
    }

    const [section, settingKey] = splitConfigurationKey(key);
    const settings = vscode.workspace.getConfiguration(section, folderUri);
    try {
      await flushWorkspaceSettingsDocuments(folderUri);
      await settings.update(settingKey, value, vscode.ConfigurationTarget.WorkspaceFolder);
      return;
    } catch (error) {
      if (!isSettingsConflictError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await flushWorkspaceSettingsDocuments(folderUri);
      await sleep(120 * attempt);
    }
  }
}

export async function waitForWorkspaceFolderUri(
  scopeUri: vscode.Uri,
  maxAttempts = 12,
  intervalMs = 100
): Promise<vscode.Uri | undefined> {
  const target = path.resolve(scopeUri.fsPath);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const direct = vscode.workspace.getWorkspaceFolder(scopeUri);
    if (direct?.uri) {
      return direct.uri;
    }

    const matched = (vscode.workspace.workspaceFolders || []).find(folder => path.resolve(folder.uri.fsPath) === target);
    if (matched?.uri) {
      return matched.uri;
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }
  return undefined;
}

async function flushWorkspaceSettingsDocuments(scopeUri: vscode.Uri): Promise<void> {
  const settingsPath = path.resolve(scopeUri.fsPath, '.vscode', 'settings.json');
  for (const document of vscode.workspace.textDocuments) {
    if (!document.isDirty || document.uri.scheme !== 'file') {
      continue;
    }
    if (path.resolve(document.uri.fsPath) !== settingsPath) {
      continue;
    }
    await document.save();
  }
  await vscode.workspace.saveAll(false);
}

function isSettingsConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('file has unsaved changes') ||
    message.includes('content of the file is newer') ||
    message.includes('File Modified Since') ||
    message.includes('no resource is provided')
  );
}

function splitConfigurationKey(raw: string): [string | undefined, string] {
  const firstDot = raw.indexOf('.');
  if (firstDot <= 0 || firstDot >= raw.length - 1) {
    return [undefined, raw];
  }
  return [raw.slice(0, firstDot), raw.slice(firstDot + 1)];
}
