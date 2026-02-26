import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { LessHoverProvider } from '../../providers/HoverProvider';
import { CacheManager } from '../../services/CacheManager';
import * as vscode from 'vscode';

describe('HoverProvider', () => {
  let provider: LessHoverProvider;

  beforeEach(() => {
    provider = new LessHoverProvider();
    const cache = CacheManager.getInstance();
    cache.clearAll();
    cache.setCache('test.less', 
      [{ name: '@my-var', value: '10px', position: {line:0, character:0} }],
      [{ name: '.my-mixin', params: '@a', body: '.my-mixin(@a) { color: red; }', position: {line:0, character:0} }],
      1
    );
  });

  it('should return hover info for variables', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 7)),
      getText: () => '@my-var'
    } as any;
    const pos = new vscode.Position(0, 2);
    
    const result = await provider.provideHover(doc, pos, null as any) as vscode.Hover;
    assert.ok(result);
    assert.strictEqual(((result.contents[0] as vscode.MarkdownString).value).indexOf('@my-var: 10px;') !== -1, true);
  });

  it('should render color palette for color variable hover', async () => {
    CacheManager.getInstance().setCache(
      'color.less',
      [{ name: '@brand-green', value: '#18c721', position: { line: 0, character: 0 } }],
      [],
      1
    );

    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 12)),
      getText: () => '@brand-green'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 3), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(!preview.includes('Colors:'));
    assert.ok(preview.includes('```less'));
    assert.ok(preview.includes('■'));
    assert.ok(preview.includes('style="color:#18c721;"'));
    assert.ok(preview.includes('color:'));
  });

  it('should return hover info for mixins', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9)),
      getText: () => '.my-mixin'
    } as any;
    const pos = new vscode.Position(0, 2);
    
    const result = await provider.provideHover(doc, pos, null as any) as vscode.Hover;
    assert.ok(result);
    assert.strictEqual(((result.contents[0] as vscode.MarkdownString).value).indexOf('.my-mixin(@a) {') !== -1, true);
  });

  it('should return undefined if no exact match', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9)),
      getText: () => '.not-exist'
    } as any;
    const pos = new vscode.Position(0, 2);
    
    const result = await provider.provideHover(doc, pos, null as any) as vscode.Hover;
    assert.strictEqual(result, undefined);
  });

  it('should truncate mixin body preview to 5 lines', async () => {
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

    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 11)),
      getText: () => '.box-shadow'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 3), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(preview.includes('line5: 5;'));
    assert.ok(!preview.includes('line6: 6;'));
    assert.ok(preview.includes('...'));
  });

  it('should truncate preview when mixin signature contains nested function params', async () => {
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
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 11)),
      getText: () => '.box-shadow'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 4), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(preview.includes('.box-shadow(@x: 0, @y: 4px, @blur: 14px, @color: rgba(0,0,0,0.1)) {'));
    assert.ok(preview.includes('box-shadow: @arguments;'));
    assert.ok(preview.includes('...'));
    const bodyLineCount = preview.split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('box-shadow')).length;
    assert.strictEqual(bodyLineCount, 5);
  });

  it('should still truncate hover preview when mixin definition is missing outer closing brace', async () => {
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
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9)),
      getText: () => '.clearfix'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 3), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(preview.includes('.clearfix {'));
    assert.ok(preview.includes('...'));
    assert.ok(!preview.includes('visibility: hidden;'));
  });

  it('should keep 5-line preview and only show last top-level color for duplicated keys', async () => {
    CacheManager.getInstance().setCache(
      'dedupe.less',
      [],
      [{
        name: '.border-radius',
        params: '@r',
        body: `.border-radius(@r) {
  border-radius: @r;
  background-color: #00ff00;
  .a {
    background-color: #ff0;
    .b {
      background-color: #f0f;
    }
  }
  background-color: #f00;
}`,
        position: { line: 0, character: 0 }
      }],
      1
    );

    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 13)),
      getText: () => '.border-radius'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 4), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(preview.includes('```less'));
    assert.ok(preview.includes('...'));
    assert.ok(preview.includes('\n  border-radius: @r;'));
    assert.ok(preview.includes('\n  background-color: #00ff00;'));
    assert.ok(preview.includes('style="color:#ff0000;"'));
    assert.ok(!preview.includes('style="color:#00ff00;"'));
    assert.ok(!preview.includes('style="color:#ffff00;"'));
    assert.ok(!preview.includes('style="color:#ff00ff;"'));
  });

  it('should preserve nested block indentation in mixin preview', async () => {
    CacheManager.getInstance().setCache(
      'indent.less',
      [],
      [{
        name: '.indent-demo',
        params: '',
        body: `.indent-demo {
  width: 10px;
  .a {
    color: #000;
  }
}`,
        position: { line: 0, character: 0 }
      }],
      1
    );

    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 12)),
      getText: () => '.indent-demo'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 4), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(preview.includes('  .a {'));
    assert.ok(preview.includes('    color: #000;'));
    assert.ok(preview.includes('  }'));
  });

  it('should use top-level color when nested blocks have colors but key is not overridden later', async () => {
    CacheManager.getInstance().setCache(
      'dedupe-keep.less',
      [],
      [{
        name: '.border-radius',
        params: '@r',
        body: `.border-radius(@r) {
  border-radius: @r;
  background-color: #00ff00;
  .a {
    background-color: #ff0;
    .b {
      background-color: #f0f;
    }
  }
}`,
        position: { line: 0, character: 0 }
      }],
      1
    );

    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 13)),
      getText: () => '.border-radius'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 4), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(preview.includes('style="color:#00ff00;"'));
    assert.ok(!preview.includes('style="color:#ffff00;"'));
    assert.ok(!preview.includes('style="color:#ff00ff;"'));
  });

  it('should not render any color annotation when mixin has only nested colors', async () => {
    CacheManager.getInstance().setCache(
      'nested-only-color.less',
      [],
      [{
        name: '.border-radius',
        params: '@r',
        body: `.border-radius(@r) {
  border-radius: @r;
  .a {
    color: #000;
    .b {
      background-color: #f0f;
    }
  }
}`,
        position: { line: 0, character: 0 }
      }],
      1
    );

    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 13)),
      getText: () => '.border-radius'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 4), null as any) as vscode.Hover;
    const preview = (result.contents[0] as vscode.MarkdownString).value;
    assert.ok(preview.includes('color: #000;'));
    assert.ok(preview.includes('background-color: #f0f;'));
    assert.ok(!preview.includes('style="color:#000000;"'));
    assert.ok(!preview.includes('style="color:#ff00ff;"'));
  });

  it('should return undefined in vue file when position is outside less style context', async () => {
    const doc = {
      languageId: 'vue',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 7)),
      getText: () => '<template><div>@my-var</div></template>'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 4), null as any);
    assert.strictEqual(result, undefined);
  });

  it('should return undefined when token is inside less comments', async () => {
    const doc = {
      languageId: 'less',
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 3), new vscode.Position(0, 10)),
      getText: () => '// @my-var'
    } as any;

    const result = await provider.provideHover(doc, new vscode.Position(0, 6), null as any);
    assert.strictEqual(result, undefined);
  });
});
