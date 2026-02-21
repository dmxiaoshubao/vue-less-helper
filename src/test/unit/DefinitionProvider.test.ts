import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { LessDefinitionProvider } from '../../providers/DefinitionProvider';
import { CacheManager } from '../../services/CacheManager';
import * as vscode from 'vscode';

describe('DefinitionProvider', () => {
  let provider: LessDefinitionProvider;

  beforeEach(() => {
    provider = new LessDefinitionProvider();
    const cache = CacheManager.getInstance();
    cache.clearAll();
    cache.setCache('/path/to/target.less', 
      [{ name: '@my-var', value: '10px', position: {line: 5, character: 0} }],
      [{ name: '.my-mixin', params: '', body: '', position: {line: 10, character: 0} }],
      1
    );
  });

  it('should return location for variables', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 7)),
      getText: () => '@my-var'
    } as any;
    const pos = new vscode.Position(0, 2);
    
    const result = await provider.provideDefinition(doc, pos, null as any) as vscode.Location;
    assert.ok(result);
    assert.strictEqual(result.uri.fsPath, '/path/to/target.less');
    const line = result.range ? result.range.start.line : (result as any).rangeOrPosition.line;
    assert.strictEqual(line, 5);
  });

  it('should return location for mixins', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9)),
      getText: () => '.my-mixin'
    } as any;
    const pos = new vscode.Position(0, 2);
    
    const result = await provider.provideDefinition(doc, pos, null as any) as vscode.Location;
    assert.ok(result);
    assert.strictEqual(result.uri.fsPath, '/path/to/target.less');
    const line = result.range ? result.range.start.line : (result as any).rangeOrPosition.line;
    assert.strictEqual(line, 10);
  });

  it('should return undefined if no match', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9)),
      getText: () => '.not-exist'
    } as any;
    const pos = new vscode.Position(0, 2);
    
    const result = await provider.provideDefinition(doc, pos, null as any) as vscode.Location;
    assert.strictEqual(result, undefined);
  });

  it('should return undefined in vue file when position is outside less style context', async () => {
    const doc = {
      languageId: 'vue',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9)),
      getText: () => '<template><div>.my-mixin</div></template>'
    } as any;

    const result = await provider.provideDefinition(doc, new vscode.Position(0, 4), null as any);
    assert.strictEqual(result, undefined);
  });

  it('should return undefined when token is inside less comments', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 3), new vscode.Position(0, 12)),
      getText: () => '// .my-mixin'
    } as any;

    const result = await provider.provideDefinition(doc, new vscode.Position(0, 6), null as any);
    assert.strictEqual(result, undefined);
  });
});
