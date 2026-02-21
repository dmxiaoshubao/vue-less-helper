import * as assert from 'assert';
import { describe, it } from 'mocha';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LessImportService } from '../../services/LessImportService';

describe('LessImportService', () => {
  it('should extract imports while ignoring comments', () => {
    const content = `
      // @import '@/styles/skip.less';
      /* @import '@/styles/skip2.less'; */
      @import (reference) '@/styles/a.less';
      @import './b.less';
    `;
    const imports = LessImportService.extractImportPaths(content);
    assert.deepStrictEqual(imports, ['@/styles/a.less', './b.less']);
  });

  it('should only resolve configured alias and still resolve relative imports', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-import-'));
    const srcDir = path.join(workspaceRoot, 'src');
    const stylesDir = path.join(srcDir, 'styles');
    const pagesDir = path.join(srcDir, 'pages');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });

    const target = path.join(stylesDir, 'vars.less');
    const current = path.join(pagesDir, 'home.less');
    fs.writeFileSync(target, '@color: red;');
    fs.writeFileSync(current, `@import '@/styles/vars.less';`);
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

    LessImportService.clearAliasCache(workspaceRoot);
    const aliasResolved = LessImportService.resolveImportPath('@/styles/vars.less', current, workspaceRoot);
    const relativeResolved = LessImportService.resolveImportPath('../styles/vars.less', current, workspaceRoot);

    assert.strictEqual(aliasResolved, target);
    assert.strictEqual(relativeResolved, target);
  });

  it('should not resolve alias path when alias is not configured', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-import-no-alias-'));
    const srcDir = path.join(workspaceRoot, 'src');
    const stylesDir = path.join(srcDir, 'styles');
    const pagesDir = path.join(srcDir, 'pages');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });

    const target = path.join(stylesDir, 'vars.less');
    const current = path.join(pagesDir, 'home.less');
    fs.writeFileSync(target, '@color: red;');
    fs.writeFileSync(current, `@import '@/styles/vars.less';`);

    LessImportService.clearAliasCache(workspaceRoot);
    const aliasResolved = LessImportService.resolveImportPath('@/styles/vars.less', current, workspaceRoot);
    const relativeResolved = LessImportService.resolveImportPath('../styles/vars.less', current, workspaceRoot);

    assert.strictEqual(aliasResolved, null);
    assert.strictEqual(relativeResolved, target);
  });

  it('should resolve aliases from tsconfig extends chain', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-import-extends-'));
    const srcDir = path.join(workspaceRoot, 'src');
    const stylesDir = path.join(srcDir, 'styles');
    const pagesDir = path.join(srcDir, 'pages');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });

    const target = path.join(stylesDir, 'tokens.less');
    const current = path.join(pagesDir, 'home.less');
    fs.writeFileSync(target, '@color: red;');
    fs.writeFileSync(current, '.home { color: @color; }');

    fs.writeFileSync(
      path.join(workspaceRoot, 'tsconfig.base.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*']
          }
        }
      })
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'tsconfig.json'),
      JSON.stringify({
        extends: './tsconfig.base.json',
        compilerOptions: {}
      })
    );

    LessImportService.clearAliasCache(workspaceRoot);
    const aliasResolved = LessImportService.resolveImportPath('@/styles/tokens.less', current, workspaceRoot);
    assert.strictEqual(aliasResolved, target);
  });

  it('should prefer longer alias prefix when multiple aliases overlap', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-import-alias-priority-'));
    const srcCommonDir = path.join(workspaceRoot, 'src', 'common');
    const srcCoreDir = path.join(workspaceRoot, 'src', 'core');
    const pagesDir = path.join(workspaceRoot, 'src', 'pages');
    fs.mkdirSync(srcCommonDir, { recursive: true });
    fs.mkdirSync(srcCoreDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });

    const target = path.join(srcCoreDir, 'theme.less');
    const current = path.join(pagesDir, 'home.less');
    fs.writeFileSync(target, '@theme: #333;');
    fs.writeFileSync(current, '.home { color: @theme; }');

    fs.writeFileSync(
      path.join(workspaceRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/common/*'],
            '@core/*': ['src/core/*']
          }
        }
      })
    );

    LessImportService.clearAliasCache(workspaceRoot);
    const aliasResolved = LessImportService.resolveImportPath('@core/theme.less', current, workspaceRoot);
    assert.strictEqual(aliasResolved, target);
  });
});
