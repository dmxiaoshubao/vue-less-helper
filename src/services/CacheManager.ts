import * as path from 'path';
import { LessMixin, LessVariable } from '../types/less';

export interface LessDocumentCache {
  variables: LessVariable[];
  mixins: LessMixin[];
  version: number;
  workspaceRoot?: string;
}

export class CacheManager {
  private static instance: CacheManager;
  private cacheMap: Map<string, LessDocumentCache> = new Map();
  private cacheRevision = 0;
  private derivedDirty = true;
  private allVariablesCache: LessVariable[] | null = null;
  private allMixinsCache: LessMixin[] | null = null;
  private uniqueVariablesCache: LessVariable[] | null = null;
  private uniqueMixinsCache: LessMixin[] | null = null;
  private variableByName: Map<string, LessVariable> = new Map();
  private mixinByName: Map<string, LessMixin> = new Map();
  private variableListByName: Map<string, LessVariable[]> = new Map();
  private mixinListByName: Map<string, LessMixin[]> = new Map();
  private workspaceDerivedCache: Map<
    string,
    {
      revision: number;
      uniqueVariables: LessVariable[];
      uniqueMixins: LessMixin[];
      variableByName: Map<string, LessVariable>;
      mixinByName: Map<string, LessMixin>;
      variableListByName: Map<string, LessVariable[]>;
      mixinListByName: Map<string, LessMixin[]>;
    }
  > = new Map();

  private constructor() {}

  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  public setCache(
    uri: string,
    variables: LessVariable[],
    mixins: LessMixin[],
    version: number = 0,
    workspaceRoot?: string
  ) {
    const normalizedUri = path.resolve(uri);
    const normalizedWorkspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : undefined;
    const normalizedVariables = variables.map(variable => ({ ...variable, uri: normalizedUri }));
    const normalizedMixins = mixins.map(mixin => ({ ...mixin, uri: normalizedUri }));
    this.cacheMap.set(normalizedUri, {
      variables: normalizedVariables,
      mixins: normalizedMixins,
      version,
      workspaceRoot: normalizedWorkspaceRoot
    });
    this.markDirty();
  }

  public getCache(uri: string): LessDocumentCache | undefined {
    return this.cacheMap.get(path.resolve(uri));
  }

  public removeCache(uri: string) {
    if (this.cacheMap.delete(path.resolve(uri))) {
      this.markDirty();
    }
  }

  public clearAll() {
    if (!this.cacheMap.size) {
      return;
    }
    this.cacheMap.clear();
    this.markDirty();
  }

  public hasCache(uri: string): boolean {
    return this.cacheMap.has(path.resolve(uri));
  }

  public getAllVariables(): LessVariable[] {
    this.ensureDerivedCaches();
    return this.allVariablesCache || [];
  }

  public getAllMixins(): LessMixin[] {
    this.ensureDerivedCaches();
    return this.allMixinsCache || [];
  }

  public getUniqueVariables(): LessVariable[] {
    this.ensureDerivedCaches();
    return this.uniqueVariablesCache || [];
  }

  public getUniqueMixins(): LessMixin[] {
    this.ensureDerivedCaches();
    return this.uniqueMixinsCache || [];
  }

  public findVariable(name: string): LessVariable | undefined {
    this.ensureDerivedCaches();
    return this.variableByName.get(name);
  }

  public findMixin(name: string): LessMixin | undefined {
    this.ensureDerivedCaches();
    return this.mixinByName.get(name);
  }

  public getUniqueVariablesByWorkspace(workspaceRoot: string | undefined): LessVariable[] {
    if (!workspaceRoot) {
      return this.getUniqueVariables();
    }
    return this.getWorkspaceDerivedCache(workspaceRoot).uniqueVariables;
  }

  public getUniqueMixinsByWorkspace(workspaceRoot: string | undefined): LessMixin[] {
    if (!workspaceRoot) {
      return this.getUniqueMixins();
    }
    return this.getWorkspaceDerivedCache(workspaceRoot).uniqueMixins;
  }

  public findVariableByWorkspace(name: string, workspaceRoot: string | undefined): LessVariable | undefined {
    if (!workspaceRoot) {
      return this.findVariable(name);
    }
    return this.getWorkspaceDerivedCache(workspaceRoot).variableByName.get(name);
  }

  public findMixinByWorkspace(name: string, workspaceRoot: string | undefined): LessMixin | undefined {
    if (!workspaceRoot) {
      return this.findMixin(name);
    }
    return this.getWorkspaceDerivedCache(workspaceRoot).mixinByName.get(name);
  }

  public findVariablesByName(name: string): LessVariable[] {
    this.ensureDerivedCaches();
    return this.variableListByName.get(name) || [];
  }

  public findMixinsByName(name: string): LessMixin[] {
    this.ensureDerivedCaches();
    return this.mixinListByName.get(name) || [];
  }

  public findVariablesByNameInWorkspace(name: string, workspaceRoot: string | undefined): LessVariable[] {
    if (!workspaceRoot) {
      return this.findVariablesByName(name);
    }
    return this.getWorkspaceDerivedCache(workspaceRoot).variableListByName.get(name) || [];
  }

  public findMixinsByNameInWorkspace(name: string, workspaceRoot: string | undefined): LessMixin[] {
    if (!workspaceRoot) {
      return this.findMixinsByName(name);
    }
    return this.getWorkspaceDerivedCache(workspaceRoot).mixinListByName.get(name) || [];
  }

  private rebuildDerivedCaches() {
    const allVars: LessVariable[] = [];
    const allMixins: LessMixin[] = [];
    const varMap: Map<string, LessVariable> = new Map();
    const mixinMap: Map<string, LessMixin> = new Map();
    const varListMap: Map<string, LessVariable[]> = new Map();
    const mixinListMap: Map<string, LessMixin[]> = new Map();

    for (const cache of this.cacheMap.values()) {
      allVars.push(...cache.variables);
      allMixins.push(...cache.mixins);
      for (const variable of cache.variables) {
        if (!varListMap.has(variable.name)) {
          varListMap.set(variable.name, []);
        }
        varListMap.get(variable.name)!.push(variable);
        if (!varMap.has(variable.name)) {
          varMap.set(variable.name, variable);
        }
      }
      for (const mixin of cache.mixins) {
        if (!mixinListMap.has(mixin.name)) {
          mixinListMap.set(mixin.name, []);
        }
        mixinListMap.get(mixin.name)!.push(mixin);
        if (!mixinMap.has(mixin.name)) {
          mixinMap.set(mixin.name, mixin);
        }
      }
    }

    this.allVariablesCache = allVars;
    this.allMixinsCache = allMixins;
    this.variableByName = varMap;
    this.mixinByName = mixinMap;
    this.variableListByName = varListMap;
    this.mixinListByName = mixinListMap;
    this.uniqueVariablesCache = [...varMap.values()];
    this.uniqueMixinsCache = [...mixinMap.values()];
    this.derivedDirty = false;
    this.workspaceDerivedCache.clear();
  }

  private ensureDerivedCaches() {
    if (this.derivedDirty || !this.allVariablesCache || !this.allMixinsCache) {
      this.rebuildDerivedCaches();
    }
  }

  private markDirty() {
    this.derivedDirty = true;
    this.cacheRevision += 1;
  }

  private getWorkspaceDerivedCache(workspaceRoot: string) {
    const normalizedRoot = path.resolve(workspaceRoot);
    const cached = this.workspaceDerivedCache.get(normalizedRoot);
    if (cached && cached.revision === this.cacheRevision) {
      return cached;
    }

    const variableByName: Map<string, LessVariable> = new Map();
    const mixinByName: Map<string, LessMixin> = new Map();
    const variableListByName: Map<string, LessVariable[]> = new Map();
    const mixinListByName: Map<string, LessMixin[]> = new Map();

    for (const [filePath, cache] of this.cacheMap.entries()) {
      if (!this.isPathInWorkspace(filePath, normalizedRoot, cache.workspaceRoot)) {
        continue;
      }
      for (const variable of cache.variables) {
        if (!variableListByName.has(variable.name)) {
          variableListByName.set(variable.name, []);
        }
        variableListByName.get(variable.name)!.push(variable);
        if (!variableByName.has(variable.name)) {
          variableByName.set(variable.name, variable);
        }
      }
      for (const mixin of cache.mixins) {
        if (!mixinListByName.has(mixin.name)) {
          mixinListByName.set(mixin.name, []);
        }
        mixinListByName.get(mixin.name)!.push(mixin);
        if (!mixinByName.has(mixin.name)) {
          mixinByName.set(mixin.name, mixin);
        }
      }
    }

    const next = {
      revision: this.cacheRevision,
      uniqueVariables: [...variableByName.values()],
      uniqueMixins: [...mixinByName.values()],
      variableByName,
      mixinByName,
      variableListByName,
      mixinListByName
    };
    this.workspaceDerivedCache.set(normalizedRoot, next);
    return next;
  }

  private isPathInWorkspace(filePath: string, workspaceRoot: string, ownerWorkspaceRoot?: string): boolean {
    if (ownerWorkspaceRoot) {
      return path.resolve(ownerWorkspaceRoot) === workspaceRoot;
    }
    const normalizedFile = path.resolve(filePath);
    return normalizedFile === workspaceRoot || normalizedFile.startsWith(workspaceRoot + path.sep);
  }
}
