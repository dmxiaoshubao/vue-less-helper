import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CacheManager } from '../../services/CacheManager';
import { LessCompletionProvider } from '../../providers/CompletionProvider';
import { LessHoverProvider } from '../../providers/HoverProvider';
import { LessDefinitionProvider } from '../../providers/DefinitionProvider';
import { LessParser } from '../../services/LessParser';
import { LessIndexEngine } from '../../services/LessIndexEngine';

describe('Performance Baseline', () => {
  const token = { isCancellationRequested: false } as vscode.CancellationToken;
  let completionProvider: LessCompletionProvider;
  let hoverProvider: LessHoverProvider;
  let definitionProvider: LessDefinitionProvider;

  beforeEach(() => {
    completionProvider = new LessCompletionProvider();
    hoverProvider = new LessHoverProvider();
    definitionProvider = new LessDefinitionProvider();

    const cache = CacheManager.getInstance();
    cache.clearAll();
    cache.setCache('perf.less', buildPerfVariables(600), buildPerfMixins(600), Date.now());
  });

  it('completion p95 should stay below 120ms under 1200 symbols', async () => {
    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: '.mx-' }),
      getText: () => ''
    } as any;

    // warm-up
    await completionProvider.provideCompletionItems(doc, new vscode.Position(0, 4), token, null as any);

    const durations: number[] = [];
    for (let i = 0; i < 35; i++) {
      const start = performance.now();
      await completionProvider.provideCompletionItems(doc, new vscode.Position(0, 4), token, null as any);
      durations.push(performance.now() - start);
    }

    const p95 = percentile(durations, 0.95);
    const avg = average(durations);
    console.log(`[perf] completion: avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);
    assert.ok(p95 < 120, `completion p95=${p95.toFixed(2)}ms, expected <120ms`);
  });

  it('hover/definition p95 should stay below 150ms under 1200 symbols', async () => {
    const hoverDoc = {
      getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 7)),
      getText: () => '@var-10'
    } as any;
    const defDoc = hoverDoc;

    const hoverDurations: number[] = [];
    const definitionDurations: number[] = [];

    for (let i = 0; i < 60; i++) {
      const hoverStart = performance.now();
      await hoverProvider.provideHover(hoverDoc, new vscode.Position(0, 2), token);
      hoverDurations.push(performance.now() - hoverStart);

      const defStart = performance.now();
      await definitionProvider.provideDefinition(defDoc, new vscode.Position(0, 2), token);
      definitionDurations.push(performance.now() - defStart);
    }

    const hoverP95 = percentile(hoverDurations, 0.95);
    const definitionP95 = percentile(definitionDurations, 0.95);
    console.log(
      `[perf] hover/definition: ` +
      `hover(avg=${average(hoverDurations).toFixed(2)}ms,p95=${hoverP95.toFixed(2)}ms), ` +
      `definition(avg=${average(definitionDurations).toFixed(2)}ms,p95=${definitionP95.toFixed(2)}ms)`
    );
    assert.ok(hoverP95 < 150, `hover p95=${hoverP95.toFixed(2)}ms, expected <150ms`);
    assert.ok(definitionP95 < 150, `definition p95=${definitionP95.toFixed(2)}ms, expected <150ms`);
  });

  it('parser full extraction should stay below 2000ms for large less text', () => {
    const content = buildLargeLessContent(1400, 500);
    const start = performance.now();
    const vars = LessParser.extractVariables(content);
    const mixins = LessParser.extractMixins(content);
    const duration = performance.now() - start;
    console.log(`[perf] parser: duration=${duration.toFixed(2)}ms, vars=${vars.length}, mixins=${mixins.length}`);

    assert.ok(vars.length >= 1400, `expected >=1400 vars, got ${vars.length}`);
    assert.ok(mixins.length >= 500, `expected >=500 mixins, got ${mixins.length}`);
    assert.ok(duration < 2000, `parser duration=${duration.toFixed(2)}ms, expected <2000ms`);
  });

  it('high-frequency completion should not show obvious heap growth', function () {
    if (typeof global.gc !== 'function') {
      this.skip();
      return;
    }

    const doc = {
      languageId: 'less',
      lineAt: () => ({ text: 'color: @' }),
      getText: () => ''
    } as any;

    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200; i++) {
      void completionProvider.provideCompletionItems(doc, new vscode.Position(0, 8), token, null as any);
    }
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const growth = after - before;
    console.log(`[perf] heap-growth: ${growth} bytes`);

    // 允许少量噪音增长，防止把正常的 V8 波动误判成泄漏
    assert.ok(growth < 8 * 1024 * 1024, `heap growth=${growth} bytes, expected <8MB`);
  });

  it('incremental reindex should be faster than full rebuild on large fixture', async function () {
    this.timeout(20000);

    const fixture = createLargeIndexFixture(24);
    const engineFull = new LessIndexEngine(fixture.workspaceRoot, {});
    const engineInc = new LessIndexEngine(fixture.workspaceRoot, {});
    engineFull.setEntries(fixture.entries);
    engineInc.setEntries(fixture.entries);

    await engineFull.rebuildAll();
    await engineInc.rebuildAll();

    const fullRuns: number[] = [];
    const incrementalRuns: number[] = [];
    for (let i = 0; i < 5; i++) {
      mutateFixtureTarget(fixture.targetFile, i);

      const fullStart = performance.now();
      await engineFull.rebuildAll();
      fullRuns.push(performance.now() - fullStart);

      const incStart = performance.now();
      await engineInc.rebuildByChangedFile(fixture.targetFile);
      incrementalRuns.push(performance.now() - incStart);
    }

    const avgFull = average(fullRuns);
    const avgIncremental = average(incrementalRuns);
    const threshold = avgFull * 0.6 + 5;
    console.log(
      `[perf] reindex: avgFull=${avgFull.toFixed(2)}ms, ` +
      `avgIncremental=${avgIncremental.toFixed(2)}ms, threshold=${threshold.toFixed(2)}ms`
    );
    assert.ok(
      avgIncremental <= threshold,
      `avgIncremental=${avgIncremental.toFixed(2)}ms should <= ${threshold.toFixed(2)}ms (avgFull=${avgFull.toFixed(2)}ms)`
    );
  });
});

function buildPerfVariables(size: number) {
  return Array.from({ length: size }, (_, idx) => ({
    name: `@var-${idx}`,
    value: idx % 3 === 0 ? '#1890ff' : `${idx}px`,
    position: { line: idx, character: 0 }
  }));
}

function buildPerfMixins(size: number) {
  return Array.from({ length: size }, (_, idx) => ({
    name: `.mx-${idx}`,
    params: '@a',
    body: `.mx-${idx}(@a) { width: @a; height: @a; color: #333; }`,
    position: { line: idx, character: 0 }
  }));
}

function buildLargeLessContent(varCount: number, mixinCount: number): string {
  const vars = Array.from({ length: varCount }, (_, idx) => `@var-${idx}: ${idx}px;`).join('\n');
  const mixins = Array.from({ length: mixinCount }, (_, idx) => {
    return `.mixin-${idx}(@x) {\n  width: @x;\n  height: @x;\n  border: 1px solid #ccc;\n}`;
  }).join('\n');
  return `${vars}\n${mixins}`;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createLargeIndexFixture(entryCount: number): { workspaceRoot: string; entries: string[]; targetFile: string } {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vlh-perf-index-'));
  const stylesDir = path.join(workspaceRoot, 'styles');
  fs.mkdirSync(stylesDir, { recursive: true });

  const sharedFile = path.join(stylesDir, 'shared.less');
  const sharedBlocks = Array.from({ length: 240 }, (_, idx) => `@shared-${idx}: ${idx}px;`).join('\n');
  fs.writeFileSync(sharedFile, `${sharedBlocks}\n.shared-mixin() { color: #333; }`);

  const entries: string[] = [];
  for (let i = 0; i < entryCount; i++) {
    const localFile = path.join(stylesDir, `local-${i}.less`);
    const entryFile = path.join(stylesDir, `entry-${i}.less`);
    const localVars = Array.from({ length: 90 }, (_, idx) => `@l-${i}-${idx}: ${idx}px;`).join('\n');
    const localMixins = Array.from({ length: 40 }, (_, idx) => {
      return `.lmx-${i}-${idx}(@x) {\n  width: @x;\n  height: @x;\n  border: 1px solid #ccc;\n}`;
    }).join('\n');
    fs.writeFileSync(localFile, `${localVars}\n${localMixins}`);
    fs.writeFileSync(entryFile, `@import './shared.less';\n@import './local-${i}.less';\n@entry-${i}: ${i}px;`);
    entries.push(entryFile);
  }

  const targetFile = entries[entries.length - 1];
  return { workspaceRoot, entries, targetFile };
}

function mutateFixtureTarget(targetFile: string, revision: number) {
  const original = fs.readFileSync(targetFile, 'utf8');
  const stripped = original.replace(/\n@rev-marker:.*/g, '');
  fs.writeFileSync(targetFile, `${stripped}\n@rev-marker: ${revision};`);
}
