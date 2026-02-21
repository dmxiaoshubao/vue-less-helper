import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { sleep, waitForWorkspaceFolderUri } from './testUtils';

suite('Multi Root Regression', () => {
  test('same symbol name should resolve by active workspace root', async function () {
    this.timeout(45000);

    const primaryRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(primaryRoot, 'primary workspace root is required');

    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-host-multi-root-'));
    const fixtureDirB = path.join(rootB, 'src', 'styles', 'host-multi-root-b');
    const entryB = path.join(fixtureDirB, 'index.less');
    const useB = path.join(fixtureDirB, 'use.less');
    const settingsDirB = path.join(rootB, '.vscode');
    const settingsFileB = path.join(settingsDirB, 'settings.json');
    fs.mkdirSync(fixtureDirB, { recursive: true });
    fs.mkdirSync(settingsDirB, { recursive: true });
    fs.writeFileSync(entryB, `.box-shadow() {\n  box-shadow: 0 0 0 #0a0;\n}\n`, 'utf8');
    fs.writeFileSync(useB, `.probe {\n  .box-shadow;\n}\n`, 'utf8');

    const rootBUri = vscode.Uri.file(rootB);
    const settings = vscode.workspace.getConfiguration('vueLessHelper');
    const prevWorkspaceLessFiles = settings.get<string[]>('lessFiles');

    let added = false;
    try {
      added = vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders?.length || 0,
        0,
        { uri: rootBUri, name: 'host-multi-root-b' }
      );
      assert.strictEqual(added, true, 'second workspace folder should be added');
      await sleep(800);
      const workspaceB = await waitForWorkspaceFolderUri(rootBUri, 20, 120);
      assert.ok(workspaceB, 'second workspace folder should be available for scoped settings');
      fs.writeFileSync(
        settingsFileB,
        `${JSON.stringify({ 'vueLessHelper.lessFiles': ['src/styles/host-multi-root-b/index.less'] }, null, 2)}\n`,
        'utf8'
      );
      await sleep(1800);

      const doc = await vscode.workspace.openTextDocument(useB);
      await vscode.window.showTextDocument(doc);
      const isFolderSettingsReady = await hasCompletionItem(doc.uri, new vscode.Position(1, 6), '.box-shadow', 3200);
      if (!isFolderSettingsReady) {
        await updateWorkspaceLessFilesWithRetry([entryB]);
        await sleep(1000);
      }

      const completionPos = new vscode.Position(1, 6); // ".box-|shadow;"
      const completion = await waitForCompletionItem(doc.uri, completionPos, '.box-shadow');
      const completionPreview = markdownToText(completion.documentation);
      assert.ok(completionPreview.includes('#0a0'), 'completion should use workspace-B symbol body');
      assert.ok(!completionPreview.includes('rgba(0,0,0,0.1)'), 'completion should not leak workspace-A symbol body');

      const hoverPreview = await waitForHoverPreview(doc.uri, new vscode.Position(1, 7), '.box-shadow');
      assert.ok(hoverPreview.includes('#0a0'), 'hover should use workspace-B symbol body');
      assert.ok(!hoverPreview.includes('rgba(0,0,0,0.1)'), 'hover should not leak workspace-A symbol body');
    } finally {
      await updateWorkspaceLessFilesWithRetry(prevWorkspaceLessFiles);
      const folders = vscode.workspace.workspaceFolders || [];
      const removeIndex = folders.findIndex(folder => folder.uri.fsPath === rootB);
      if (removeIndex >= 0) {
        vscode.workspace.updateWorkspaceFolders(removeIndex, 1);
      }
      await sleep(260);

      if (fs.existsSync(rootB)) {
        fs.rmSync(rootB, { recursive: true, force: true });
      }
    }
  });
});

async function waitForCompletionItem(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedLabel: string
): Promise<vscode.CompletionItem> {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const result = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      uri,
      position,
      '.'
    );
    const item = result?.items?.find(candidate => String(candidate.label) === expectedLabel);
    if (item) {
      return item;
    }
    await sleep(120);
  }
  throw new Error(`Completion item not found: ${expectedLabel}`);
}

async function waitForHoverPreview(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedToken: string
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      uri,
      position
    );
    for (const hover of hovers || []) {
      const preview = hover.contents.map(content => markdownToText(content as any)).join('\n');
      if (preview.includes(expectedToken)) {
        return preview;
      }
    }
    await sleep(120);
  }
  throw new Error(`Hover preview not found for token: ${expectedToken}`);
}

function markdownToText(value: vscode.MarkdownString | vscode.MarkedString | vscode.MarkedString[] | undefined): string {
  if (!value) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(item => markdownToText(item as any)).join('\n');
  }
  if (typeof value === 'string') {
    return value;
  }
  if ((value as vscode.MarkdownString).value !== undefined) {
    return (value as vscode.MarkdownString).value;
  }
  return JSON.stringify(value);
}

async function hasCompletionItem(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedLabel: string,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      uri,
      position,
      '.'
    );
    const item = result?.items?.find(candidate => String(candidate.label) === expectedLabel);
    if (item) {
      return true;
    }
    await sleep(120);
  }
  return false;
}

async function updateWorkspaceLessFilesWithRetry(value: string[] | undefined): Promise<void> {
  const settings = vscode.workspace.getConfiguration('vueLessHelper');
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await vscode.workspace.saveAll(false);
      await settings.update('lessFiles', value, vscode.ConfigurationTarget.Workspace);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('file has unsaved changes') &&
        !message.includes('content of the file is newer') &&
        !message.includes('File Modified Since')
      ) {
        throw error;
      }
      await sleep(120 * attempt);
    }
  }
}
