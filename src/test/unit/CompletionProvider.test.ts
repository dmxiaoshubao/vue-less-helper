import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { LessCompletionProvider } from '../../providers/CompletionProvider';
import { CacheManager } from '../../services/CacheManager';
import { LessHoverProvider } from '../../providers/HoverProvider';
import * as vscode from 'vscode';

describe('CompletionProvider', () => {
  let provider: LessCompletionProvider;

  beforeEach(() => {
    provider = new LessCompletionProvider();
    const cache = CacheManager.getInstance();
    cache.clearAll();
    cache.setCache('test.less', 
      [{ name: '@primary-color', value: '#1890ff', position: {line:0, character: 0} }],
      [{ name: '.border-radius', params: '@radius', body: '.border-radius(@radius) { border-radius: @radius; }', position: {line:0, character:0} },
       { name: '.flex-center', params: '', body: '.flex-center() { display: flex; align-items: center; justify-content: center; }', position: {line:0, character:0} }],
      1
    );
  });

  it('should return variable completion on @ trigger', async () => {
    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: 'color: @' }),
      getText: () => ''
    } as any;
    const pos = new vscode.Position(0, 8);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].label, '@primary-color');
    assert.strictEqual(result[0].kind, vscode.CompletionItemKind.Color);
  });

  it('should return mixin completion on . trigger', async () => {
    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: '  .' }),
      getText: () => ''
    } as any;
    const pos = new vscode.Position(0, 3);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    assert.strictEqual(result.length, 2); // 包含 .border-radius 和 .flex-center 两项
    assert.ok(result.find(i => i.label === '.border-radius'));
    assert.strictEqual(result[0].kind, vscode.CompletionItemKind.Method);
  });

  it('should not return completion outside style tag in vue file', async () => {
    const doc = {
      languageId: 'vue',
      lineAt: () => ({ text: '<div>@' }),
      getText: () => '<template>\n  <div>@'
    } as any;
    const pos = new vscode.Position(1, 7);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    assert.strictEqual(result, undefined);
  });

  it('should return completion inside style tag in vue file', async () => {
    const doc = {
      languageId: 'vue',
      lineAt: () => ({ text: 'color: @' }),
      getText: () => '<template></template>\n<style lang="less">\n.box {\n  color: @' // 模拟到光标前的文本
    } as any;
    const pos = new vscode.Position(3, 10);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    assert.ok(result);
    assert.strictEqual(result.length, 1);
  });

  it('should trigger completion on colon and space for property values', async () => {
    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: '  border: ' }),
      getText: () => ''
    } as any;
    const pos = new vscode.Position(0, 10);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    assert.ok(result);
    assert.strictEqual(result.length > 0, true);
    // 应该只补全变量
    const hasMixin = result.some(item => item.kind === vscode.CompletionItemKind.Method);
    assert.strictEqual(hasMixin, false, 'Should not show mixins for property value triggers');
  });

  it('should not return completion in vue file if style lang is not less', async () => {
    const doc = {
      languageId: 'vue',
      lineAt: () => ({ text: 'color: @' }),
      getText: () => '<template></template>\n<style scoped>\n.box {\n  color: @' 
    } as any;
    const pos = new vscode.Position(3, 10);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    assert.strictEqual(result, undefined);
  });

  it('should not return completion inside less line comments', async () => {
    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: '// color: @' }),
      getText: () => '// color: @'
    } as any;
    const pos = new vscode.Position(0, 10);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any);
    assert.strictEqual(result, undefined);
  });

  it('should deduplicate variables and mixins', async () => {
    // Inject duplicates
    CacheManager.getInstance().setCache('test2.less', 
      [{ name: '@primary-color', value: '#ffffff', position: {line:0, character: 0} }],
      [{ name: '.border-radius', params: '', body: '', position: {line:0, character:0} }],
      1
    );

    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: 'color: @' }),
      getText: () => ''
    } as any;
    const pos = new vscode.Position(0, 8);

    const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
    // @primary-color 应去重
    assert.strictEqual(result.length, 1);
  });

  it('should keep completion preview consistent with hover in less files and truncate to 5 lines', async () => {
    CacheManager.getInstance().setCache(
      'long.less',
      [],
      [{
        name: '.box-shadow',
        params: '@x',
        body: `.box-shadow(@x) {
  line1: 1;
  line2: 2;
  line3: 3;
  line4: 4;
  line5: 5;
  line6: 6;
}`,
        position: { line: 0, character: 0 }
      }],
      1
    );

    const completionDoc = {
      languageId: 'less',
      lineAt: () => ({ text: '.box' }),
      getText: () => ''
    } as any;
    const completionPos = new vscode.Position(0, 4);

    const completionResult = await provider.provideCompletionItems(
      completionDoc,
      completionPos,
      null as any,
      null as any
    ) as vscode.CompletionItem[];
    const completionItem = completionResult.find(i => i.label === '.box-shadow');
    assert.ok(completionItem);
    const completionPreview = (completionItem!.documentation as vscode.MarkdownString).value;

    const hoverProvider = new LessHoverProvider();
    const hoverDoc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 11)),
      getText: () => '.box-shadow'
    } as any;
    const hoverResult = await hoverProvider.provideHover(hoverDoc, new vscode.Position(0, 3), null as any) as vscode.Hover;
    const hoverPreview = (hoverResult.contents[0] as vscode.MarkdownString).value;

    assert.strictEqual(completionPreview, hoverPreview);
    assert.ok(completionPreview.includes('line5: 5;'));
    assert.ok(!completionPreview.includes('line6: 6;'));
    assert.ok(completionPreview.includes('...'));
  });

  it('should truncate completion preview for mixin with nested function params', async () => {
    CacheManager.getInstance().setCache(
      'nested.less',
      [],
      [{
        name: '.box-shadow',
        params: '@x',
        body: `.box-shadow(@x: 0, @y: 4px, @blur: 14px, @color: rgba(0,0,0,0.1)) {
  -webkit-box-shadow: @arguments;
  -moz-box-shadow: @arguments;
  box-shadow: @arguments;
  box-shadow: @arguments;
  box-shadow: @arguments;
  box-shadow: @arguments;
  box-shadow: @arguments;
}`,
        position: { line: 0, character: 0 }
      }],
      1
    );

    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: '.box' }),
      getText: () => ''
    } as any;

    const result = await provider.provideCompletionItems(doc, new vscode.Position(0, 4), null as any, null as any) as vscode.CompletionItem[];
    const item = result.find(i => i.label === '.box-shadow');
    assert.ok(item);
    const preview = (item!.documentation as vscode.MarkdownString).value;
    assert.ok(preview.includes('rgba(0,0,0,0.1)) {'));
    assert.ok(preview.includes('...'));
    const bodyLineCount = preview.split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('box-shadow')).length;
    assert.strictEqual(bodyLineCount, 5);
  });

  it('should still truncate completion preview when mixin definition is missing outer closing brace', async () => {
    CacheManager.getInstance().setCache(
      'broken.less',
      [],
      [{
        name: '.clearfix',
        params: '',
        body: `.clearfix {
  display: block;
  zoom: 1;

  &:after {
    content: " ";
    display: block;
    font-size: 0;
    height: 0;
    clear: both;
    visibility: hidden;
  }`,
        position: { line: 0, character: 0 }
      }],
      1
    );

    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: '.clear' }),
      getText: () => ''
    } as any;

    const result = await provider.provideCompletionItems(doc, new vscode.Position(0, 6), null as any, null as any) as vscode.CompletionItem[];
    const item = result.find(i => i.label === '.clearfix');
    assert.ok(item);
    const preview = (item!.documentation as vscode.MarkdownString).value;
    assert.ok(preview.includes('.clearfix {'));
    assert.ok(preview.includes('...'));
    assert.ok(!preview.includes('visibility: hidden;'));
  });

  describe('User specified edge cases for mixins triggers', () => {
    // 覆盖用户指定的: .flex-center; 的各种光标位移截断场景
    const mixinName = '.flex-center';
    
    it('case 1: .flex-cent|er', async () => {
      const doc = {
        languageId: 'less',
        lineAt: () => ({ text: '.flex-center' }),
        getText: () => ''
      } as any;
      const pos = new vscode.Position(0, 10); // 光标在 t 之后
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      
      const flexItem = result.find(i => i.label === '.flex-center');
      assert.ok(flexItem);
      // 应包含正确截取 range 覆盖后缀 er
      assert.ok(flexItem.range);
    });

    it('case 6: .flex-center |;', async () => {
      const doc = {
        languageId: 'less',
        lineAt: () => ({ text: '.flex-center ;' }),
        getText: () => ''
      } as any;
      const pos = new vscode.Position(0, 12); // 光标改回在 r 之后
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      
      const flexItem = result.find(i => i.label === '.flex-center');
      assert.ok(flexItem, 'flexItem should be found');
      // 有分号结尾，不会再生成分号
      assert.ok(!(flexItem.insertText as vscode.SnippetString).value.endsWith(';'));
    });
    
    it('case 9: .border-radius|();', async () => {
      const doc = {
        languageId: 'less',
        lineAt: () => ({ text: '.border-radius();' }),
        getText: () => ''
      } as any;
      const pos = new vscode.Position(0, 14); // 光标在 s 之后
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      
      const item = result.find(i => i.label === '.border-radius');
      assert.ok(item);
      assert.strictEqual((item.insertText as vscode.SnippetString).value, '.border-radius($1);');
    });

    it('mixin without params and without ()', async () => {
      const doc = { languageId: 'less', lineAt: () => ({ text: '.flex-ce' }), getText: () => '' } as any;
      const pos = new vscode.Position(0, 8);
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      const item = result.find(i => i.label === '.flex-center')!;
      assert.strictEqual((item.insertText as vscode.SnippetString).value, '.flex-center;');
    });

    it('mixin without params but with ()', async () => {
      const doc = { languageId: 'less', lineAt: () => ({ text: '.flex-ce();' }), getText: () => '' } as any;
      const pos = new vscode.Position(0, 8);
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      const item = result.find(i => i.label === '.flex-center')!;
      assert.strictEqual((item.insertText as vscode.SnippetString).value, '.flex-center;');
      assert.strictEqual((item.range as vscode.Range).end.character, 11); // overrides the `();` completely
    });

    it('mixin with params and without ()', async () => {
      const doc = { languageId: 'less', lineAt: () => ({ text: '.border-ra' }), getText: () => '' } as any;
      const pos = new vscode.Position(0, 10);
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      const item = result.find(i => i.label === '.border-radius')!;
      assert.strictEqual((item.insertText as vscode.SnippetString).value, '.border-radius($1);');
    });

    it('variable at property value', async () => {
      const doc = { languageId: 'less', lineAt: () => ({ text: 'color: @my-' }), getText: () => '' } as any;
      const pos = new vscode.Position(0, 11);
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      const item = result.find(i => i.label === '@primary-color');
      // In this setup the cache only has @primary-color, testing that it inserts it right
      assert.ok(item, 'primary-color should exist');
      assert.strictEqual(item.insertText, '@primary-color;');
    });
    
    it('variable at property value empty space', async () => {
      const doc = { languageId: 'less', lineAt: () => ({ text: 'color: ' }), getText: () => '' } as any;
      const pos = new vscode.Position(0, 7);
      const result = await provider.provideCompletionItems(doc, pos, null as any, null as any) as vscode.CompletionItem[];
      const item = result.find(i => i.label === '@primary-color');
      assert.ok(item);
      assert.strictEqual(item.insertText, '@primary-color;');
    });
  });
});
