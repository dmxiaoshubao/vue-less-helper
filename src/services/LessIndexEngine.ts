import * as fs from 'fs';
import * as path from 'path';
import { LessImportService } from './LessImportService';
import { LessParser } from './LessParser';
import { LessMixin, LessVariable } from '../types/less';

type AliasConfig = Record<string, string>;

type RawFileData = {
  variables: LessVariable[];
  mixins: LessMixin[];
  imports: string[];
};

export type IndexFilePayload = {
  variables: LessVariable[];
  mixins: LessMixin[];
  version: number;
};

export type IndexDiff = {
  upserts: Map<string, IndexFilePayload>;
  removals: string[];
};

export class LessIndexEngine {
  private workspaceRoot: string;
  private aliasConfig: AliasConfig;
  private entryPaths: string[] = [];
  private entryToFiles: Map<string, Set<string>> = new Map();
  private fileToEntries: Map<string, Set<string>> = new Map();
  private fileRawData: Map<string, RawFileData> = new Map();

  constructor(workspaceRoot: string, aliasConfig: AliasConfig = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.aliasConfig = aliasConfig;
  }

  public setWorkspaceRoot(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  public setAliasConfig(aliasConfig: AliasConfig) {
    this.aliasConfig = aliasConfig;
  }

  public setEntries(entries: string[]) {
    const normalized = entries
      .map(entry => path.resolve(entry))
      .filter((entry, idx, arr) => arr.indexOf(entry) === idx);
    this.entryPaths = normalized;
    for (const entry of normalized) {
      if (!this.entryToFiles.has(entry)) {
        this.entryToFiles.set(entry, new Set());
      }
    }
  }

  public getEntries(): string[] {
    return [...this.entryPaths];
  }

  public getWatchFiles(): string[] {
    const files = new Set<string>();
    for (const entry of this.entryPaths) {
      files.add(entry);
    }
    for (const filePath of this.fileRawData.keys()) {
      files.add(filePath);
    }
    files.add(path.join(this.workspaceRoot, 'tsconfig.json'));
    files.add(path.join(this.workspaceRoot, 'jsconfig.json'));
    return [...files];
  }

  public getAffectedEntries(changedFile: string): string[] {
    const normalized = path.resolve(changedFile);
    const affected = new Set<string>();

    const owners = this.fileToEntries.get(normalized);
    if (owners) {
      owners.forEach(owner => affected.add(owner));
    }

    if (this.entryPaths.includes(normalized)) {
      affected.add(normalized);
    }

    return [...affected];
  }

  public async rebuildAll(): Promise<IndexDiff> {
    const previousFiles = new Set(this.fileRawData.keys());
    this.entryToFiles.clear();
    this.fileToEntries.clear();
    this.fileRawData.clear();
    for (const entry of this.entryPaths) {
      this.entryToFiles.set(entry, new Set());
    }

    const parseRunCache = new Map<string, RawFileData | null>();
    const touched = new Set<string>();
    for (const entry of this.entryPaths) {
      const entryFiles = new Set<string>();
      await this.walkEntry(entry, entry, entryFiles, new Set(), parseRunCache, touched);
      this.entryToFiles.set(entry, entryFiles);
    }

    const upserts = new Map<string, IndexFilePayload>();
    for (const filePath of this.fileRawData.keys()) {
      const owner = this.resolvePrimaryOwner(this.fileToEntries.get(filePath));
      if (!owner) continue;
      const payload = this.buildPayload(filePath, owner);
      if (payload) upserts.set(filePath, payload);
    }

    const removals = [...previousFiles].filter(filePath => !this.fileRawData.has(filePath));
    return { upserts, removals };
  }

  public async rebuildByChangedFile(changedFile: string): Promise<IndexDiff> {
    const affectedEntries = this.getAffectedEntries(changedFile);
    if (!affectedEntries.length) {
      return { upserts: new Map(), removals: [] };
    }

    return this.rebuildEntries(affectedEntries);
  }

  private async rebuildEntries(entries: string[]): Promise<IndexDiff> {
    const affectedEntries = entries
      .map(entry => path.resolve(entry))
      .filter(entry => this.entryPaths.includes(entry))
      .filter((entry, idx, arr) => arr.indexOf(entry) === idx);

    if (!affectedEntries.length) {
      return { upserts: new Map(), removals: [] };
    }

    const touchedFiles = new Set<string>();
    const oldPrimaryOwner = new Map<string, string>();

    for (const entry of affectedEntries) {
      const oldFiles = this.entryToFiles.get(entry) || new Set<string>();
      for (const filePath of oldFiles) {
        touchedFiles.add(filePath);
        const owners = this.fileToEntries.get(filePath);
        if (!owners) continue;
        const oldOwner = this.resolvePrimaryOwner(owners);
        if (oldOwner) {
          oldPrimaryOwner.set(filePath, oldOwner);
        }
        owners.delete(entry);
        if (!owners.size) {
          this.fileToEntries.delete(filePath);
        }
      }
      this.entryToFiles.set(entry, new Set());
    }

    const parseRunCache = new Map<string, RawFileData | null>();
    for (const entry of affectedEntries) {
      const entryFiles = new Set<string>();
      await this.walkEntry(entry, entry, entryFiles, new Set(), parseRunCache, touchedFiles);
      this.entryToFiles.set(entry, entryFiles);
    }

    const upserts = new Map<string, IndexFilePayload>();
    const removals: string[] = [];
    for (const filePath of touchedFiles) {
      const owners = this.fileToEntries.get(filePath);
      if (!owners || !owners.size) {
        this.fileToEntries.delete(filePath);
        this.fileRawData.delete(filePath);
        removals.push(filePath);
        continue;
      }

      const oldOwner = oldPrimaryOwner.get(filePath);
      const newOwner = this.resolvePrimaryOwner(owners);
      if (!newOwner) continue;

      const parsedInThisRun = parseRunCache.has(filePath);
      if (parsedInThisRun || oldOwner !== newOwner) {
        const payload = this.buildPayload(filePath, newOwner);
        if (payload) {
          upserts.set(filePath, payload);
        }
      }
    }

    return { upserts, removals };
  }

  private async walkEntry(
    filePath: string,
    ownerEntry: string,
    entryFiles: Set<string>,
    visited: Set<string>,
    parseRunCache: Map<string, RawFileData | null>,
    touchedFiles: Set<string>
  ) {
    const normalized = path.resolve(filePath);
    if (visited.has(normalized)) {
      return;
    }
    visited.add(normalized);

    const raw = await this.getOrParseRawFile(normalized, parseRunCache);
    if (!raw) {
      return;
    }

    entryFiles.add(normalized);
    touchedFiles.add(normalized);

    let owners = this.fileToEntries.get(normalized);
    if (!owners) {
      owners = new Set<string>();
      this.fileToEntries.set(normalized, owners);
    }
    owners.add(ownerEntry);

    for (const importedFile of raw.imports) {
      await this.walkEntry(importedFile, ownerEntry, entryFiles, visited, parseRunCache, touchedFiles);
    }
  }

  private async getOrParseRawFile(filePath: string, parseRunCache: Map<string, RawFileData | null>): Promise<RawFileData | null> {
    if (parseRunCache.has(filePath)) {
      return parseRunCache.get(filePath) || null;
    }

    const parsed = await this.parseRawFile(filePath);
    parseRunCache.set(filePath, parsed);
    if (parsed) {
      this.fileRawData.set(filePath, parsed);
    }
    return parsed;
  }

  private async parseRawFile(filePath: string): Promise<RawFileData | null> {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const imports = LessImportService.extractImportPaths(content)
        .map(importPath => LessImportService.resolveImportPath(importPath, filePath, this.workspaceRoot, this.aliasConfig))
        .filter((resolved): resolved is string => !!resolved);
      return {
        variables: LessParser.extractVariables(content),
        mixins: LessParser.extractMixins(content),
        imports
      };
    } catch {
      return null;
    }
  }

  private resolvePrimaryOwner(owners: Set<string> | undefined): string | undefined {
    if (!owners || !owners.size) {
      return undefined;
    }
    for (const entry of this.entryPaths) {
      if (owners.has(entry)) {
        return entry;
      }
    }
    return [...owners][0];
  }

  private buildPayload(filePath: string, ownerEntry: string): IndexFilePayload | null {
    const raw = this.fileRawData.get(filePath);
    if (!raw) {
      return null;
    }

    const variables = raw.variables.map(variable => ({
      ...variable,
      importUri: ownerEntry
    }));
    const mixins = raw.mixins.map(mixin => ({
      ...mixin,
      importUri: ownerEntry
    }));

    return {
      variables,
      mixins,
      version: Date.now()
    };
  }
}
