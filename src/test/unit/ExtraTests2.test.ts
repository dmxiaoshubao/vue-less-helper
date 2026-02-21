import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { LessCompletionProvider } from '../../providers/CompletionProvider';
import { CacheManager } from '../../services/CacheManager';
import * as vscode from 'vscode';

describe('Extra Tests 2 - Space and Comments', () => {
  let provider: LessCompletionProvider;

  beforeEach(() => {
    provider = new LessCompletionProvider();
    const cache = CacheManager.getInstance();
    cache.clearAll();
    cache.setCache('test.less', 
      [{ name: '@my-color', value: '#1890ff', position: {line:0, character: 0} }],
      [{ name: '.border-radius', params: '@radius', body: '.border-radius(@radius) { }', position: {line:0, character:0} },
       { name: '.flex-center', params: '', body: '.flex-center() {  }', position: {line:0, character:0} }],
      1
    );
  });

  it('mixin with physical space: .flex-cent er;', async () => {
    const doc = { languageId: 'less', lineAt: () => ({ text: '.flex-cent er;' }), getText: () => '' } as any;
    const pos = new vscode.Position(0, 10); // after 'cent'
    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    const item = result.find(i => i.label === '.flex-center')!;
    
    assert.strictEqual((item.insertText as vscode.SnippetString).value, '.flex-center');
    assert.strictEqual((item.range as vscode.Range).end.character, 13); // includes ' er' but before ';'
  });

  it('mixin with physical space and parens: .flex-ce nter();', async () => {
    const doc = { languageId: 'less', lineAt: () => ({ text: '.flex-ce nter();' }), getText: () => '' } as any;
    const pos = new vscode.Position(0, 8); // after 'ce'
    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    const item = result.find(i => i.label === '.flex-center')!;
    
    // Because .flex-center has NO params, it overrides the parens as well!
    assert.strictEqual((item.insertText as vscode.SnippetString).value, '.flex-center;');
    assert.strictEqual((item.range as vscode.Range).end.character, 16); // overrides ' nter();'
  });

  it('mixin with physical space and trailing comment: .border-radi us(); // hello', async () => {
    const doc = { languageId: 'less', lineAt: () => ({ text: '.border-radi us(); // hello' }), getText: () => '' } as any;
    const pos = new vscode.Position(0, 12); // after 'radi'
    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    const item = result.find(i => i.label === '.border-radius')!;
    
    assert.strictEqual((item.insertText as vscode.SnippetString).value, '.border-radius($1);');
    assert.strictEqual((item.range as vscode.Range).end.character, 18); // overrides ' us(); '
  });

  it('variable with physical space and comment: color: @my-col or; /* c */', async () => {
    const doc = { languageId: 'less', lineAt: () => ({ text: 'color: @my-col or; /* c */' }), getText: () => '' } as any;
    const pos = new vscode.Position(0, 14); // after 'col'
    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    const item = result.find(i => i.label === '@my-color')!;
    
    assert.strictEqual(item.insertText, '@my-color');
    assert.strictEqual((item.range as vscode.Range).end.character, 17); // overrides ' or'
  });
});
