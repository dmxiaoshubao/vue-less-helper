import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { WorkspaceService } from '../../services/WorkspaceService';

describe('WorkspaceService', () => {
  it('should detect less language document', () => {
    const document = {
      languageId: 'less',
      getText: () => '@color: #fff;'
    } as any;

    assert.strictEqual(WorkspaceService.documentUsesLess(document), true);
  });

  it('should detect vue document with style lang less', () => {
    const document = {
      languageId: 'vue',
      getText: () => '<template></template><style scoped lang="less">.a { color: red; }</style>'
    } as any;

    assert.strictEqual(WorkspaceService.documentUsesLess(document), true);
  });

  it('should ignore vue document without style lang less', () => {
    const document = {
      languageId: 'vue',
      getText: () => '<template></template><style scoped>.a { color: red; }</style>'
    } as any;

    assert.strictEqual(WorkspaceService.documentUsesLess(document), false);
  });

  it('should treat workspace with source files as vue/less project even without deps', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-ws-source-'));
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'App.vue'), '<template><div /></template>', 'utf8');

    const originalFolders = (vscode.workspace as any).workspaceFolders;
    try {
      (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
      const result = await WorkspaceService.checkVueOrLessDependency();
      assert.strictEqual(result, true);
    } finally {
      (vscode.workspace as any).workspaceFolders = originalFolders;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('should still disable when package exists but no deps and no vue/less source', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-ws-empty-'));
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'main.js'), 'console.log(1);', 'utf8');

    const originalFolders = (vscode.workspace as any).workspaceFolders;
    try {
      (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
      const result = await WorkspaceService.checkVueOrLessDependency();
      assert.strictEqual(result, false);
    } finally {
      (vscode.workspace as any).workspaceFolders = originalFolders;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
