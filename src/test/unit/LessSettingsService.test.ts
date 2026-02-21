import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { after, before, beforeEach, describe, it } from 'mocha';
import * as vscode from 'vscode';
import { LessSettingsService } from '../../services/LessSettingsService';

type LessSettingsSnapshot = {
  next: string[] | undefined;
  noticeNext: boolean | undefined;
  legacy: string[] | undefined;
  notice: boolean | undefined;
  suppressNotice: boolean | undefined;
};

function getScopeUri(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getWorkspaceSettingsPath(): string | undefined {
  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }
  return path.join(root, '.vscode', 'settings.json');
}

function readSettingsObject(): Record<string, unknown> {
  const settingsPath = getWorkspaceSettingsPath();
  if (!settingsPath || !fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettingsObject(settings: Record<string, unknown>): void {
  const settingsPath = getWorkspaceSettingsPath();
  if (!settingsPath) {
    return;
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function readSetting<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration(undefined, getScopeUri()).get<T>(key);
}

function hasExplicitSetting(key: string): boolean {
  const inspected = vscode.workspace.getConfiguration(undefined, getScopeUri()).inspect<unknown>(key);
  if (!inspected) {
    return false;
  }
  return inspected.workspaceFolderValue !== undefined || inspected.workspaceValue !== undefined;
}

async function waitForLegacySettingApplied(key: string, value: unknown): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2500) {
    if (value === undefined) {
      if (!hasExplicitSetting(key)) {
        return;
      }
    } else {
      try {
        assert.deepStrictEqual(readSetting<unknown>(key), value);
        return;
      } catch {
        // keep polling
      }
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
}

async function updateSetting(key: string, value: unknown): Promise<void> {
  const scopeUri = getScopeUri();
  const updateByApi = async (): Promise<void> => {
    if (scopeUri) {
      await vscode.workspace
        .getConfiguration(undefined, scopeUri)
        .update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
      return;
    }
    await vscode.workspace
      .getConfiguration()
      .update(key, value, vscode.ConfigurationTarget.Workspace);
  };

  if (key.startsWith('less.')) {
    try {
      await updateByApi();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('not a registered configuration')) {
        throw error;
      }
    }

    const settings = readSettingsObject();
    const before = settings[key];
    if (value === undefined) {
      delete settings[key];
    } else {
      settings[key] = value;
    }
    const after = settings[key];
    writeSettingsObject(settings);
    if (before !== after) {
      await waitForLegacySettingApplied(key, value);
    }
    return;
  }

  await updateByApi();
}

describe('LessSettingsService', () => {
  let snapshot: LessSettingsSnapshot;

  before(() => {
    snapshot = {
      next: readSetting<string[]>('vueLessHelper.lessFiles'),
      noticeNext: readSetting<boolean>('vueLessHelper.notice'),
      legacy: readSetting<string[]>('less.files'),
      notice: readSetting<boolean>('less.notice'),
      suppressNotice: readSetting<boolean>('less.suppressNotice')
    };
  });

  after(async () => {
    await updateSetting('vueLessHelper.lessFiles', snapshot.next);
    await updateSetting('vueLessHelper.notice', snapshot.noticeNext);
    await updateSetting('less.files', snapshot.legacy);
    await updateSetting('less.notice', snapshot.notice);
    await updateSetting('less.suppressNotice', snapshot.suppressNotice);
  });

  beforeEach(async () => {
    await updateSetting('vueLessHelper.lessFiles', undefined);
    await updateSetting('vueLessHelper.notice', undefined);
    await updateSetting('less.files', undefined);
    await updateSetting('less.notice', undefined);
    await updateSetting('less.suppressNotice', undefined);
  });

  it('should prefer vueLessHelper.lessFiles when both new and legacy settings exist', async () => {
    await updateSetting('vueLessHelper.lessFiles', ['src/styles/new.less']);
    await updateSetting('less.files', ['src/styles/legacy.less']);

    const files = LessSettingsService.getConfiguredLessFiles();
    assert.deepStrictEqual(files, ['src/styles/new.less']);
  });

  it('should fallback to legacy less.files when new setting is empty', async () => {
    await updateSetting('vueLessHelper.lessFiles', []);
    await updateSetting('less.files', ['src/styles/legacy.less']);

    const files = LessSettingsService.getConfiguredLessFiles();
    assert.deepStrictEqual(files, ['src/styles/legacy.less']);
  });

  it('should save less files to vueLessHelper.lessFiles only', async () => {
    const scope = getScopeUri() || vscode.Uri.file('/tmp/workspace');
    await LessSettingsService.saveLessFiles(scope, [
      'src/styles/a.less',
      'src/styles/a.less',
      '  '
    ]);

    assert.deepStrictEqual(readSetting<string[]>('vueLessHelper.lessFiles'), ['src/styles/a.less']);
    const lessFilesInspect = vscode.workspace.getConfiguration(undefined, getScopeUri()).inspect<unknown>('less.files');
    assert.strictEqual(lessFilesInspect?.workspaceFolderValue, undefined);
    assert.strictEqual(lessFilesInspect?.workspaceValue, undefined);
  });

  it('should respect vueLessHelper.notice flag and allow disabling via helper', async () => {
    await updateSetting('vueLessHelper.notice', true);
    assert.strictEqual(LessSettingsService.isNoticeEnabled(), true);

    await LessSettingsService.setNoticeEnabled(getScopeUri() || vscode.Uri.file('/tmp/workspace'), false);

    assert.strictEqual(LessSettingsService.isNoticeEnabled(), false);
  });

  it('should fallback to less.notice and less.suppressNotice when new key is not configured', async function () {
    this.timeout(8000);

    assert.strictEqual(LessSettingsService.isNoticeEnabled(), true);

    await updateSetting('less.notice', false);
    assert.strictEqual(LessSettingsService.isNoticeEnabled(), false);

    await updateSetting('less.notice', undefined);
    await updateSetting('less.suppressNotice', true);
    assert.strictEqual(LessSettingsService.isNoticeEnabled(), false);
  });
});
