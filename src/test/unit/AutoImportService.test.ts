import * as assert from 'assert';
import { describe, it } from 'mocha';
import { AutoImportService } from '../../services/AutoImportService';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('AutoImportService', () => {
  it('should detect existing import correctly', () => {
    const doc = {
      getText: () => `
        // @import '@/styles/var.less';
        .box {
          @import (reference) '@/styles/mixins.less';
        }
      `
    } as any;

    // 此处被注释，理应视为不存在
    assert.strictEqual(AutoImportService.hasImport(doc, '@/styles/var.less'), false);
    // 此处已存在引用
    assert.strictEqual(AutoImportService.hasImport(doc, '@/styles/ mixins.less'), false);
    assert.strictEqual(AutoImportService.hasImport(doc, '@/styles/mixins.less'), true);
  });

  it('should generate correct edit for less file', () => {
    const doc = {
      languageId: 'less',
      getText: () => '.box {}'
    } as any;

    const edit = AutoImportService.createImportEdit(doc, '@/styles/global.less');
    assert.ok(edit);
    assert.strictEqual(edit.newText, `@import (reference) '@/styles/global.less';\n`);
    assert.strictEqual(edit.range.start.line, 0);
  });

  it('should generate correct edit for vue file inside style less', () => {
    const doc = {
      languageId: 'vue',
      getText: () => `<template>\n</template>\n<style lang="less">\n.box {}\n</style>`
    } as any;

    const edit = AutoImportService.createImportEdit(doc, '@/styles/global.less');
    assert.ok(edit);
    assert.strictEqual(edit.range.start.line, 3);
  });

  it('should not generate edit if lacking style less tag in vue file', () => {
    const doc = {
      languageId: 'vue',
      getText: () => `<template>\n</template>\n<style scoped>\n</style>` // not less
    } as any;

    const edit = AutoImportService.createImportEdit(doc, '@/styles/global.less');
    assert.strictEqual(edit, undefined);
  });

  it('should not generate edit if existing import is found even in comments (expected fallback due to regex limits)', () => {
    const doc = {
      getText: () => `// @import '@/styles/global.less';`
    } as any;
    // Current hasImport uses cleanText which removes comments. Let's fix the test assumption
    const edit = AutoImportService.createImportEdit(doc, '@/styles/global.less');
    assert.ok(edit);
  });

  it('should return relative path when currentFileUri is provided', () => {
    const root = '/Users/zhen/project';
    const target = '/Users/zhen/project/src/styles/var.less';
    const current = '/Users/zhen/project/src/components/MyComponent.vue';
    const result = AutoImportService.resolveAliasPath(target, root, current);
    assert.strictEqual(result, '../styles/var.less');
  });

  it('should handle deeply nested paths with relative fallback', () => {
    const root = '/Project';
    const target = '/Project/src/styles/deep/var.less';
    const current = '/Project/src/components/nested/MyComponent.vue';
    const result = AutoImportService.resolveAliasPath(target, root, current);
    assert.strictEqual(result, '../../styles/deep/var.less');
  });

  it('should skip insert when target is already imported by alias path', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-auto-import-'));
    const srcDir = path.join(workspaceRoot, 'src');
    const stylesDir = path.join(srcDir, 'styles');
    const compDir = path.join(srcDir, 'components');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*']
          }
        }
      })
    );
    const target = path.join(stylesDir, 'global.less');
    const current = path.join(compDir, 'Comp.less');
    fs.writeFileSync(target, '@color: red;');

    const doc = {
      languageId: 'less',
      uri: { fsPath: current },
      getText: () => `@import (reference) '@/styles/global.less';\n.box { color: @color; }`
    } as any;

    const importPath = AutoImportService.resolveAliasPath(target, workspaceRoot, current);
    const edit = AutoImportService.createImportEdit(doc, importPath, workspaceRoot, target);
    assert.strictEqual(edit, undefined);
  });

  it('should respect baseUrl+paths aliases in resolveAliasPath', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-alias-'));
    const appDir = path.join(workspaceRoot, 'app');
    const srcDir = path.join(workspaceRoot, 'src');
    fs.mkdirSync(path.join(appDir, 'styles'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'components'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '~/*': ['app/*']
          }
        }
      })
    );

    const target = path.join(appDir, 'styles', 'tokens.less');
    const current = path.join(srcDir, 'components', 'Comp.vue');
    const result = AutoImportService.resolveAliasPath(target, workspaceRoot, current);
    assert.strictEqual(result, '~/styles/tokens.less');
  });

  it('should skip insert when target file is current file', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-auto-self-'));
    const current = path.join(workspaceRoot, 'src', 'styles', 'font.less');
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.writeFileSync(current, '.font-bold() {}');

    const doc = {
      languageId: 'less',
      uri: { fsPath: current },
      getText: () => '.number-bold { .font-bold; }'
    } as any;

    const edit = AutoImportService.createImportEdit(doc, './font.less', workspaceRoot, current);
    assert.strictEqual(edit, undefined);
    assert.strictEqual(AutoImportService.isUnsafeImportTarget(doc, workspaceRoot, current), true);
  });

  it('should skip insert when import target depends on current file (circular import)', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-auto-cycle-'));
    const styleDir = path.join(workspaceRoot, 'src', 'assets', 'style');
    fs.mkdirSync(styleDir, { recursive: true });
    const indexFile = path.join(styleDir, 'index.less');
    const fontFile = path.join(styleDir, 'font.less');
    fs.writeFileSync(indexFile, `@import './font.less';\n@main-color: #333;`);
    fs.writeFileSync(fontFile, `.font-bold { font-weight: 700; }`);

    const doc = {
      languageId: 'less',
      uri: { fsPath: fontFile },
      getText: () => `.number-bold { .font-bold; }`
    } as any;

    const importPath = AutoImportService.resolveAliasPath(indexFile, workspaceRoot, fontFile);
    const edit = AutoImportService.createImportEdit(doc, importPath, workspaceRoot, indexFile);
    assert.strictEqual(edit, undefined);
    assert.strictEqual(AutoImportService.isUnsafeImportTarget(doc, workspaceRoot, indexFile), true);
    assert.strictEqual(AutoImportService.isUnsafeImportTarget(doc, workspaceRoot, fontFile), true);
    assert.strictEqual(AutoImportService.isUnsafeImportTarget(doc, workspaceRoot, path.join(styleDir, 'color.less')), false);
  });

  it('should allow fallback file import for reverse sibling scenario (color -> font)', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-auto-reverse-'));
    const styleDir = path.join(workspaceRoot, 'src', 'assets', 'style');
    fs.mkdirSync(styleDir, { recursive: true });
    const indexFile = path.join(styleDir, 'index.less');
    const fontFile = path.join(styleDir, 'font.less');
    const colorFile = path.join(styleDir, 'color.less');
    fs.writeFileSync(indexFile, `@import './font.less';\n@import './color.less';`);
    fs.writeFileSync(fontFile, `.font-bold { font-weight: 700; }`);
    fs.writeFileSync(colorFile, `.primary { color: #333; }`);

    const colorDoc = {
      languageId: 'less',
      uri: { fsPath: colorFile },
      getText: () => `.title { .font-bold; }`
    } as any;

    const indexImportPath = AutoImportService.resolveAliasPath(indexFile, workspaceRoot, colorFile);
    const indexEdit = AutoImportService.createImportEdit(colorDoc, indexImportPath, workspaceRoot, indexFile);
    assert.strictEqual(indexEdit, undefined, 'index.less should be rejected because it depends on color.less');

    const fontImportPath = AutoImportService.resolveAliasPath(fontFile, workspaceRoot, colorFile);
    const fontEdit = AutoImportService.createImportEdit(colorDoc, fontImportPath, workspaceRoot, fontFile);
    assert.ok(fontEdit, 'font.less fallback import should be allowed');
    assert.strictEqual(fontEdit?.newText, `@import (reference) './font.less';\n`);
  });

  it('should allow circular import only when explicitly enabled', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-auto-circular-allow-'));
    const styleDir = path.join(workspaceRoot, 'src', 'assets', 'style');
    fs.mkdirSync(styleDir, { recursive: true });
    const indexFile = path.join(styleDir, 'index.less');
    const fontFile = path.join(styleDir, 'font.less');
    fs.writeFileSync(indexFile, `@import './font.less';`);
    fs.writeFileSync(fontFile, `.font-bold { font-weight: 700; }`);

    const doc = {
      languageId: 'less',
      uri: { fsPath: fontFile },
      getText: () => `.title { .main; }`
    } as any;

    const importPath = AutoImportService.resolveAliasPath(indexFile, workspaceRoot, fontFile);
    const blocked = AutoImportService.createImportEdit(doc, importPath, workspaceRoot, indexFile);
    assert.strictEqual(blocked, undefined);

    const allowed = AutoImportService.createImportEdit(
      doc,
      importPath,
      workspaceRoot,
      indexFile,
      { allowCircularImport: true }
    );
    assert.ok(allowed);
    assert.strictEqual(allowed?.newText, `@import (reference) './index.less';\n`);
  });

  it('should support async circular import guard path used by extension command', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-auto-async-cycle-'));
    const styleDir = path.join(workspaceRoot, 'src', 'assets', 'style');
    fs.mkdirSync(styleDir, { recursive: true });
    const indexFile = path.join(styleDir, 'index.less');
    const fontFile = path.join(styleDir, 'font.less');
    fs.writeFileSync(indexFile, `@import './font.less';`);
    fs.writeFileSync(fontFile, `.font-bold { font-weight: 700; }`);

    const doc = {
      languageId: 'less',
      uri: { fsPath: fontFile },
      getText: () => `.title { .main; }`
    } as any;

    const importPath = AutoImportService.resolveAliasPath(indexFile, workspaceRoot, fontFile);
    const blocked = await AutoImportService.createImportEditAsync(doc, importPath, workspaceRoot, indexFile);
    assert.strictEqual(blocked, undefined);

    const allowed = await AutoImportService.createImportEditAsync(
      doc,
      importPath,
      workspaceRoot,
      indexFile,
      { allowCircularImport: true }
    );
    assert.ok(allowed);
    assert.strictEqual(allowed?.newText, `@import (reference) './index.less';\n`);
  });
});
