import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sleep } from './testUtils';

suite('Demo Workspace Multi Root', () => {
  test('folder settings should isolate demo mixins across roots', async function () {
    this.timeout(45000);

    const folders = vscode.workspace.workspaceFolders || [];
    const byBaseName = new Map<string, string>();
    for (const folder of folders) {
      byBaseName.set(path.basename(folder.uri.fsPath), folder.uri.fsPath);
    }

    const tsRoot = byBaseName.get('tsconfig-alias');
    const jsRoot = byBaseName.get('jsconfig-alias');
    if (!tsRoot || !jsRoot) {
      this.skip();
      return;
    }

    const tsProbeFile = path.join(tsRoot, 'src', 'styles', 'components', 'host-demo-multi-root-ts.less');
    const jsProbeFile = path.join(jsRoot, 'src', 'styles', 'components', 'host-demo-multi-root-js.less');
    fs.mkdirSync(path.dirname(tsProbeFile), { recursive: true });
    fs.mkdirSync(path.dirname(jsProbeFile), { recursive: true });
    fs.writeFileSync(tsProbeFile, `.probe {\n  .ts-box\n}\n`, 'utf8');
    fs.writeFileSync(jsProbeFile, `.probe {\n  .js-box\n}\n`, 'utf8');

    try {
      await sleep(800);

      const tsDoc = await vscode.workspace.openTextDocument(tsProbeFile);
      await vscode.window.showTextDocument(tsDoc);
      const tsPosition = new vscode.Position(1, 9);
      const tsItem = await waitForCompletionItem(tsDoc.uri, tsPosition, '.ts-box-shadow');
      const tsPreview = markdownToText(tsItem.documentation);
      assert.ok(tsPreview.includes('#0a0'), 'ts root should resolve ts mixin preview');
      assert.ok(!tsPreview.includes('#1677ff'), 'ts root should not leak js mixin preview');

      const tsLabels = await getCompletionLabels(tsDoc.uri, tsPosition);
      assert.ok(tsLabels.includes('.ts-box-shadow'), 'ts root should have ts mixin completion');
      assert.ok(!tsLabels.includes('.js-box-shadow'), 'ts root should not expose js-only mixin');

      const jsDoc = await vscode.workspace.openTextDocument(jsProbeFile);
      await vscode.window.showTextDocument(jsDoc);
      const jsPosition = new vscode.Position(1, 9);
      const jsItem = await waitForCompletionItem(jsDoc.uri, jsPosition, '.js-box-shadow');
      const jsPreview = markdownToText(jsItem.documentation);
      assert.ok(jsPreview.includes('#1677ff'), 'js root should resolve js mixin preview');
      assert.ok(!jsPreview.includes('#0a0'), 'js root should not leak ts mixin preview');

      const jsLabels = await getCompletionLabels(jsDoc.uri, jsPosition);
      assert.ok(jsLabels.includes('.js-box-shadow'), 'js root should have js mixin completion');
      assert.ok(!jsLabels.includes('.ts-box-shadow'), 'js root should not expose ts-only mixin');
    } finally {
      if (fs.existsSync(tsProbeFile)) {
        fs.rmSync(tsProbeFile, { force: true });
      }
      if (fs.existsSync(jsProbeFile)) {
        fs.rmSync(jsProbeFile, { force: true });
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

async function getCompletionLabels(uri: vscode.Uri, position: vscode.Position): Promise<string[]> {
  const result = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    uri,
    position,
    '.'
  );
  return (result?.items || []).map(item => String(item.label));
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
