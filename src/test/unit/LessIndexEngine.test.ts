import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LessIndexEngine } from '../../services/LessIndexEngine';

describe('LessIndexEngine', () => {
  let workspaceRoot: string;
  let styleDir: string;
  let aFile: string;
  let bFile: string;
  let sharedFile: string;
  let engine: LessIndexEngine;

  beforeEach(async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-index-engine-'));
    styleDir = path.join(workspaceRoot, 'styles');
    fs.mkdirSync(styleDir, { recursive: true });
    aFile = path.join(styleDir, 'a.less');
    bFile = path.join(styleDir, 'b.less');
    sharedFile = path.join(styleDir, 'shared.less');

    fs.writeFileSync(sharedFile, '@shared-color: #333;\n.shared-mixin() { color: @shared-color; }');
    fs.writeFileSync(aFile, `@import './shared.less';\n@a-color: #111;`);
    fs.writeFileSync(bFile, `@import './shared.less';\n@b-color: #222;`);

    engine = new LessIndexEngine(workspaceRoot, {});
    engine.setEntries([aFile, bFile]);
    await engine.rebuildAll();
  });

  it('should index entries and shared imports on full rebuild', async () => {
    const diff = await engine.rebuildAll();
    assert.ok(diff.upserts.has(aFile));
    assert.ok(diff.upserts.has(bFile));
    assert.ok(diff.upserts.has(sharedFile));

    const sharedPayload = diff.upserts.get(sharedFile)!;
    assert.strictEqual(sharedPayload.variables[0].name, '@shared-color');
    assert.strictEqual(sharedPayload.variables[0].importUri, aFile);
  });

  it('should only rebuild affected entries on changed entry file', async () => {
    fs.writeFileSync(aFile, `@import './shared.less';\n@a-color: #abc;`);
    const diff = await engine.rebuildByChangedFile(aFile);

    assert.ok(diff.upserts.has(aFile), 'entry a should be rebuilt');
    assert.ok(diff.upserts.has(sharedFile), 'shared import of a should be rebuilt');
    assert.ok(!diff.upserts.has(bFile), 'unrelated entry b should not be rebuilt');
  });

  it('should switch shared file owner when first entry stops importing it', async () => {
    fs.writeFileSync(aFile, '@a-color: #abc;');
    const diff = await engine.rebuildByChangedFile(aFile);
    assert.ok(diff.upserts.has(sharedFile));

    const sharedPayload = diff.upserts.get(sharedFile)!;
    assert.strictEqual(sharedPayload.variables[0].importUri, bFile);
  });

  it('should remove file cache when imported file is deleted', async () => {
    fs.rmSync(sharedFile);
    const diff = await engine.rebuildByChangedFile(sharedFile);
    assert.ok(diff.removals.includes(sharedFile));
  });
});
