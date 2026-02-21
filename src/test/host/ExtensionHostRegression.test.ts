import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sleep, updateWorkspaceFolderSettingWithRetry } from './testUtils';

suite('Extension Host Regression', () => {
  const hostFixtureFileName = 'host-regression.less';

  test('less file completion preview should match hover and keep 5-line truncation', async function () {
    this.timeout(20000);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, 'workspaceRoot is required');
    const root = workspaceRoot as string;

    let configured = vscode.workspace.getConfiguration('vueLessHelper').get<string[]>('lessFiles') || [];
    const legacyConfigured = vscode.workspace.getConfiguration().get<string[]>('less.files') || [];
    if (configured.length === 0 && legacyConfigured.length === 0) {
      const fallback = ['src/styles/variables.less', 'src/styles/mixins.less'];
      await updateWorkspaceFolderSettingWithRetry(vscode.Uri.file(root), 'vueLessHelper.lessFiles', fallback);
      configured = fallback;
      await sleep(260);
    }
    assert.ok(configured.length > 0 || legacyConfigured.length > 0, 'workspace settings should define less files');
    await sleep(450);

    const fixtureFile = path.join(root, 'src', 'styles', 'components', hostFixtureFileName);
    const fixtureContent = `.probe {\n  .box\n  .box-shadow;\n}\n`;
    fs.writeFileSync(fixtureFile, fixtureContent, 'utf8');

    try {
      const doc = await vscode.workspace.openTextDocument(fixtureFile);
      await vscode.window.showTextDocument(doc);

      const completionPos = new vscode.Position(1, 6); // ".box|" in less file
      const completionItem = await waitForCompletionItem(doc.uri, completionPos, '.box-shadow');
      assert.ok(completionItem, 'completion item .box-shadow should exist');

      const completionPreview = markdownToText(completionItem.documentation);
      assert.ok(completionPreview.includes('.box-shadow('), 'completion preview should include mixin signature');
      assert.ok(completionPreview.includes('...'), 'completion preview should include ellipsis');

      const hoverPos = new vscode.Position(2, 8); // ".box-shadow;" word region
      const hoverPreview = await waitForHoverPreview(doc.uri, hoverPos, '.box-shadow');
      assert.ok(hoverPreview.includes('...'), 'hover preview should include ellipsis');

      assert.strictEqual(completionPreview, hoverPreview, 'completion and hover preview should be consistent');

      const previewBodyLines = completionPreview
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-') || line.startsWith('box-shadow:'));
      assert.strictEqual(previewBodyLines.length, 5, 'preview body should show exactly 5 lines');
    } finally {
      if (fs.existsSync(fixtureFile)) {
        fs.rmSync(fixtureFile);
      }
    }
  });

  test('auto import should prefer symbol file over entry file for sibling less dependency', async function () {
    this.timeout(25000);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, 'workspaceRoot is required');
    const root = workspaceRoot as string;

    const fixtureDir = path.join(root, 'src', 'styles', 'host-auto-import');
    const indexFile = path.join(fixtureDir, 'index.less');
    const colorFile = path.join(fixtureDir, 'color.less');
    const fontFile = path.join(fixtureDir, 'font.less');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(indexFile, `@import './font.less';\n@import './color.less';\n`, 'utf8');
    fs.writeFileSync(colorFile, `.primary() {\n  color: #ff4d4f;\n}\n`, 'utf8');
    fs.writeFileSync(
      fontFile,
      `.number-bold {\n  .pri\n  font-size: 24px;\n}\n`,
      'utf8'
    );

    const scope = vscode.Uri.file(root);
    const prevNext = vscode.workspace.getConfiguration(undefined, scope).get<string[]>('vueLessHelper.lessFiles') || [];

    try {
      await updateWorkspaceFolderSettingWithRetry(scope, 'vueLessHelper.lessFiles', ['src/styles/host-auto-import/index.less']);
      await sleep(600);

      const doc = await vscode.workspace.openTextDocument(fontFile);
      await vscode.window.showTextDocument(doc);

      const completionPos = new vscode.Position(1, 6); // ".pri|"
      const completionItem = await waitForCompletionItem(doc.uri, completionPos, '.primary');
      assert.ok(completionItem.command, 'completion item should carry auto import command');

      await vscode.commands.executeCommand(
        completionItem.command!.command,
        ...(completionItem.command!.arguments || [])
      );
      await sleep(260);

      const nextText = doc.getText();
      assert.match(
        nextText,
        /@import \(reference\) ['"][^'"]*color\.less['"];/,
        'should import color.less as symbol source file'
      );
      assert.doesNotMatch(
        nextText,
        /@import \(reference\) ['"][^'"]*index\.less['"];/,
        'should not import index.less to avoid entry-level circular import'
      );
    } finally {
      await updateWorkspaceFolderSettingWithRetry(scope, 'vueLessHelper.lessFiles', prevNext);
      await sleep(260);
      if (fs.existsSync(fixtureDir)) {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
    }
  });
});

async function waitForCompletionItem(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedLabel: string
): Promise<vscode.CompletionItem> {
  const start = Date.now();
  while (Date.now() - start < 9000) {
    const result = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      uri,
      position,
      '.'
    );
    const item = result?.items?.find(candidate =>
      String(candidate.label) === expectedLabel &&
      candidate.command?.command === 'vueLessHelper.autoImport'
    );
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
  const start = Date.now();
  while (Date.now() - start < 9000) {
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
