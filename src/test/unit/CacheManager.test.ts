import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { CacheManager } from '../../services/CacheManager';

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = CacheManager.getInstance();
    cacheManager.clearAll(); // Ensure clean state before each test
  });

  it('should set and get cache correctly', () => {
    cacheManager.setCache('file1.less', [{ name: '@color', value: 'red', position: {line:0, character:0} }], [], 1);
    
    assert.strictEqual(cacheManager.hasCache('file1.less'), true);
    
    const cache = cacheManager.getCache('file1.less');
    assert.ok(cache);
    assert.strictEqual(cache.variables.length, 1);
    assert.strictEqual(cache.variables[0].name, '@color');
    assert.strictEqual(cache.version, 1);
  });

  it('should remove cache correctly', () => {
    cacheManager.setCache('file2.less', [], [], 0);
    assert.strictEqual(cacheManager.hasCache('file2.less'), true);
    
    cacheManager.removeCache('file2.less');
    assert.strictEqual(cacheManager.hasCache('file2.less'), false);
    assert.strictEqual(cacheManager.getCache('file2.less'), undefined);
  });

  it('should merge results for multiple files', () => {
    cacheManager.setCache('f1.less', [{ name: '@c1', value: '1', position: {line:0, character:0} }], []);
    cacheManager.setCache('f2.less', [{ name: '@c2', value: '2', position: {line:0, character:0} }], []);

    const allVars = cacheManager.getAllVariables();
    assert.strictEqual(allVars.length, 2);
    assert.strictEqual(allVars[0].name, '@c1');
    assert.strictEqual(allVars[1].name, '@c2');
  });

  it('should provide unique lookup and find methods', () => {
    cacheManager.setCache('f1.less', [{ name: '@c1', value: '1', position: {line:0, character:0} }], [{ name: '.m1', params: '', body: '', position: {line:0, character:0} }]);
    cacheManager.setCache('f2.less', [{ name: '@c1', value: '2', position: {line:1, character:0} }], [{ name: '.m1', params: '@x', body: '', position: {line:1, character:0} }]);

    const uniqueVars = cacheManager.getUniqueVariables();
    const uniqueMixins = cacheManager.getUniqueMixins();
    assert.strictEqual(uniqueVars.length, 1);
    assert.strictEqual(uniqueMixins.length, 1);
    assert.strictEqual(cacheManager.findVariable('@c1')?.value, '1');
    assert.strictEqual(cacheManager.findMixin('.m1')?.params, '');
    assert.strictEqual(cacheManager.findVariablesByName('@c1').length, 2);
    assert.strictEqual(cacheManager.findMixinsByName('.m1').length, 2);
  });

  it('should scope unique/find methods by workspace root', () => {
    cacheManager.setCache(
      '/ws-a/src/a.less',
      [{ name: '@same', value: 'a', position: { line: 0, character: 0 } }],
      [{ name: '.same', params: '', body: '.same{}', position: { line: 0, character: 0 } }]
    );
    cacheManager.setCache(
      '/ws-b/src/b.less',
      [{ name: '@same', value: 'b', position: { line: 0, character: 0 } }],
      [{ name: '.same', params: '@x', body: '.same(@x){}', position: { line: 0, character: 0 } }]
    );

    const wsAVars = cacheManager.getUniqueVariablesByWorkspace('/ws-a');
    const wsAMixins = cacheManager.getUniqueMixinsByWorkspace('/ws-a');
    assert.strictEqual(wsAVars.length, 1);
    assert.strictEqual(wsAVars[0].value, 'a');
    assert.strictEqual(wsAMixins.length, 1);
    assert.strictEqual(wsAMixins[0].params, '');

    assert.strictEqual(cacheManager.findVariableByWorkspace('@same', '/ws-b')?.value, 'b');
    assert.strictEqual(cacheManager.findMixinByWorkspace('.same', '/ws-b')?.params, '@x');
    assert.strictEqual(cacheManager.findVariablesByNameInWorkspace('@same', '/ws-a').length, 1);
    assert.strictEqual(cacheManager.findMixinsByNameInWorkspace('.same', '/ws-b').length, 1);
  });

  it('should not leak symbols when workspace roots are nested', () => {
    cacheManager.setCache(
      '/repo/child/src/child.less',
      [{ name: '@child', value: '1', position: { line: 0, character: 0 } }],
      [{ name: '.child', params: '', body: '.child{}', position: { line: 0, character: 0 } }],
      1,
      '/repo/child'
    );
    cacheManager.setCache(
      '/repo/src/root.less',
      [{ name: '@root', value: '2', position: { line: 0, character: 0 } }],
      [{ name: '.root', params: '', body: '.root{}', position: { line: 0, character: 0 } }],
      1,
      '/repo'
    );

    const childVars = cacheManager.getUniqueVariablesByWorkspace('/repo/child').map(item => item.name);
    const rootVars = cacheManager.getUniqueVariablesByWorkspace('/repo').map(item => item.name);
    assert.deepStrictEqual(childVars, ['@child']);
    assert.deepStrictEqual(rootVars, ['@root']);
    assert.strictEqual(cacheManager.findMixinByWorkspace('.child', '/repo'), undefined);
    assert.strictEqual(cacheManager.findMixinByWorkspace('.child', '/repo/child')?.name, '.child');
  });
});
