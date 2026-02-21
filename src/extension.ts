import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceService } from './services/WorkspaceService';
import { CacheManager } from './services/CacheManager';
import { LessCompletionProvider } from './providers/CompletionProvider';
import { LessHoverProvider } from './providers/HoverProvider';
import { LessDefinitionProvider } from './providers/DefinitionProvider';
import { AutoImportService } from './services/AutoImportService';
import { LessImportService } from './services/LessImportService';
import { IndexDiff, IndexFilePayload, LessIndexEngine } from './services/LessIndexEngine';
import { LessMixin, LessVariable } from './types/less';
import { LessSettingsService } from './services/LessSettingsService';
import { LessOnboardingService } from './services/LessOnboardingService';

type WorkspaceIndexState = {
  root: string;
  engine: LessIndexEngine | undefined;
  watchers: vscode.FileSystemWatcher[];
  workTimer: NodeJS.Timeout | undefined;
  isIndexing: boolean;
  pendingFullReload: boolean;
  pendingChangedFiles: Set<string>;
  hasBootstrappedIndex: boolean;
  indexedFiles: Set<string>;
  disposed: boolean;
  lifecycleToken: number;
};

const workspaceStates: Map<string, WorkspaceIndexState> = new Map();

export async function activate(context: vscode.ExtensionContext) {
  const isLikelyVueOrLessProject = await WorkspaceService.checkVueOrLessDependency();
  console.log('Vue-Less-Helper is now active!');

  const documentSelector: vscode.DocumentSelector = [
    { scheme: 'file', language: 'vue' },
    { scheme: 'file', language: 'less' }
  ];

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(documentSelector, new LessCompletionProvider(), '@', '.', ':', ' '),
    vscode.languages.registerHoverProvider(documentSelector, new LessHoverProvider()),
    vscode.languages.registerDefinitionProvider(documentSelector, new LessDefinitionProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vueLessHelper.autoImport', async (varOrMixinName: string) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!workspaceFolder) {
        return;
      }
      const workspaceRoot = workspaceFolder.uri.fsPath;

      const cacheManager = CacheManager.getInstance();
      const currentFilePath = path.resolve(editor.document.uri.fsPath);
      const localCache = cacheManager.getCache(currentFilePath);
      if (localCache) {
        const existsInCurrentFile =
          localCache.variables.some(variable => variable.name === varOrMixinName) ||
          localCache.mixins.some(mixin => mixin.name === varOrMixinName);
        if (existsInCurrentFile) {
          return;
        }
      }

      const matches: Array<LessVariable | LessMixin> = [
        ...cacheManager.findVariablesByNameInWorkspace(varOrMixinName, workspaceRoot),
        ...cacheManager.findMixinsByNameInWorkspace(varOrMixinName, workspaceRoot)
      ];
      if (!matches.length) {
        return;
      }

      const candidates = [
        ...matches.map(item => ({ uri: item.importUri || '', isFallback: false })),
        ...matches.map(item => ({ uri: item.uri || '', isFallback: true }))
      ]
        .filter(item => !!item.uri)
        .filter(item => isPathInWorkspace(item.uri, workspaceRoot))
        .filter((item, idx, arr) => arr.findIndex(candidate => candidate.uri === item.uri) === idx);

      for (const candidate of candidates) {
        const candidateUri = candidate.uri;
        const importPath = AutoImportService.resolveAliasPath(candidateUri, workspaceRoot, editor.document.uri.fsPath);
        const edit = await AutoImportService.createImportEditAsync(
          editor.document,
          importPath,
          workspaceRoot,
          candidateUri,
          { allowCircularImport: candidate.isFallback }
        );
        if (edit) {
          await editor.edit(builder => builder.insert(edit.range.start, edit.newText));
          return;
        }

        const unsafe = await AutoImportService.isUnsafeImportTargetAsync(editor.document, workspaceRoot, candidateUri);
        if (!unsafe) {
          return;
        }
      }
    })
  );

  const tryBootstrapByDocument = (document?: vscode.TextDocument) => {
    if (!WorkspaceService.documentUsesLess(document) || !document) {
      return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return;
    }

    void LessOnboardingService.maybePromptForLessFiles(document);

    const state = ensureWorkspaceState(workspaceFolder.uri.fsPath);
    const hasConfiguredLessFiles = LessSettingsService.getConfiguredLessFiles(workspaceFolder.uri).length > 0;
    const needsRetryBootstrap =
      !!state.engine &&
      hasConfiguredLessFiles &&
      state.engine.getEntries().length === 0 &&
      state.indexedFiles.size === 0;

    if (!state.hasBootstrappedIndex || !state.engine || needsRetryBootstrap) {
      state.hasBootstrappedIndex = true;
      scheduleFullReload(state, 0);
    }
  };

  if (isLikelyVueOrLessProject) {
    await bootstrapAllWorkspaces();
  }
  tryBootstrapByDocument(vscode.window.activeTextEditor?.document);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      tryBootstrapByDocument(editor?.document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => {
      tryBootstrapByDocument(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(event => {
      for (const removed of event.removed) {
        disposeWorkspaceState(removed.uri.fsPath);
      }
      for (const added of event.added) {
        const state = ensureWorkspaceState(added.uri.fsPath);
        if (isLikelyVueOrLessProject) {
          state.hasBootstrappedIndex = true;
          scheduleFullReload(state);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      const folders = vscode.workspace.workspaceFolders || [];
      const changedFolders = folders.filter(folder =>
        event.affectsConfiguration('vueLessHelper.lessFiles', folder.uri) ||
        event.affectsConfiguration('less.files', folder.uri)
      );

      const lessFilesChangedGlobally =
        event.affectsConfiguration('vueLessHelper.lessFiles') ||
        event.affectsConfiguration('less.files');
      const targetFolders =
        changedFolders.length > 0 ? changedFolders : (lessFilesChangedGlobally ? folders : []);
      if (!targetFolders.length) {
        return;
      }

      for (const folder of targetFolders) {
        const state = ensureWorkspaceState(folder.uri.fsPath);
        AutoImportService.clearAliasCache(state.root);
        state.hasBootstrappedIndex = true;
        scheduleFullReload(state);
      }
    })
  );
}

async function bootstrapAllWorkspaces() {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const state = ensureWorkspaceState(folder.uri.fsPath);
    state.hasBootstrappedIndex = true;
    state.pendingFullReload = true;
    await flushScheduledIndexWork(state);
  }
}

function ensureWorkspaceState(workspaceRoot: string): WorkspaceIndexState {
  const normalizedRoot = path.resolve(workspaceRoot);
  const existing = workspaceStates.get(normalizedRoot);
  if (existing) {
    return existing;
  }

  const state: WorkspaceIndexState = {
    root: normalizedRoot,
    engine: undefined,
    watchers: [],
    workTimer: undefined,
    isIndexing: false,
    pendingFullReload: false,
    pendingChangedFiles: new Set<string>(),
    hasBootstrappedIndex: false,
    indexedFiles: new Set<string>(),
    disposed: false,
    lifecycleToken: 0
  };
  workspaceStates.set(normalizedRoot, state);
  ensureWorkspaceWatchers(state);
  return state;
}

async function flushScheduledIndexWork(state: WorkspaceIndexState) {
  if (state.isIndexing || !isWorkspaceStateActive(state)) {
    return;
  }

  const lifecycleToken = state.lifecycleToken;
  state.isIndexing = true;
  try {
    while (isWorkspaceStateActive(state, lifecycleToken) && (state.pendingFullReload || state.pendingChangedFiles.size > 0)) {
      const runFullReload = state.pendingFullReload || !state.engine;
      const changedFiles = [...state.pendingChangedFiles];
      state.pendingFullReload = false;
      state.pendingChangedFiles.clear();

      if (runFullReload) {
        await performFullReload(state, lifecycleToken);
      } else {
        await performIncrementalReload(state, changedFiles, lifecycleToken);
      }
    }
  } finally {
    state.isIndexing = false;
  }
}

async function performFullReload(state: WorkspaceIndexState, lifecycleToken: number) {
  if (!isWorkspaceStateActive(state, lifecycleToken)) {
    return;
  }

  for (const filePath of state.indexedFiles) {
    CacheManager.getInstance().removeCache(filePath);
  }
  state.indexedFiles.clear();

  const aliasConfig = LessImportService.getAliasConfig(state.root);
  const lessFiles = LessSettingsService.getConfiguredLessFiles(vscode.Uri.file(state.root));
  const entryPaths = lessFiles
    .map(filePath => resolveConfiguredLessFile(filePath, state.root, aliasConfig))
    .filter((entryPath): entryPath is string => !!entryPath);

  const engine = new LessIndexEngine(state.root, aliasConfig);
  engine.setEntries(entryPaths);
  state.engine = engine;

  const diff = await engine.rebuildAll();
  if (!isWorkspaceStateActive(state, lifecycleToken)) {
    return;
  }
  applyIndexDiff(state, diff);
}

async function performIncrementalReload(state: WorkspaceIndexState, changedFiles: string[], lifecycleToken: number) {
  if (!state.engine || !changedFiles.length || !isWorkspaceStateActive(state, lifecycleToken)) {
    return;
  }

  const mergedUpserts = new Map<string, IndexFilePayload>();
  const mergedRemovals: Set<string> = new Set();

  for (const changedFile of changedFiles) {
    const diff = await state.engine.rebuildByChangedFile(changedFile);
    for (const filePath of diff.removals) {
      mergedRemovals.add(filePath);
      mergedUpserts.delete(filePath);
    }
    diff.upserts.forEach((payload, filePath) => {
      if (!mergedRemovals.has(filePath)) {
        mergedUpserts.set(filePath, payload);
      }
    });
  }

  if ((mergedUpserts.size || mergedRemovals.size) && isWorkspaceStateActive(state, lifecycleToken)) {
    applyIndexDiff(state, {
      upserts: mergedUpserts,
      removals: [...mergedRemovals]
    });
  }
}

function applyIndexDiff(state: WorkspaceIndexState, diff: IndexDiff) {
  const cache = CacheManager.getInstance();
  diff.removals.forEach(filePath => {
    cache.removeCache(filePath);
    state.indexedFiles.delete(filePath);
  });
  diff.upserts.forEach((payload, filePath) => {
    cache.setCache(filePath, payload.variables, payload.mixins, payload.version, state.root);
    state.indexedFiles.add(filePath);
  });
}

function resolveConfiguredLessFile(
  filePath: string,
  workspaceRoot: string,
  aliasConfig: Record<string, string>
): string | null {
  const probeFile = path.join(workspaceRoot, '__vue-less-helper_probe__.less');
  const candidate = LessImportService.resolveImportPath(filePath, probeFile, workspaceRoot, aliasConfig);
  if (candidate) {
    return candidate;
  }

  if (path.isAbsolute(filePath)) {
    return path.isAbsolute(filePath) ? path.resolve(filePath) : null;
  }

  const workspaceRelative = path.resolve(workspaceRoot, filePath);
  if (workspaceRelative.endsWith('.less')) {
    return workspaceRelative;
  }
  if (!path.extname(workspaceRelative)) {
    return path.resolve(`${workspaceRelative}.less`);
  }

  return null;
}

function ensureWorkspaceWatchers(state: WorkspaceIndexState) {
  if (state.watchers.length > 0) {
    return;
  }

  const lessWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(state.root, '**/*.less')
  );
  const tsConfigWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(state.root, 'tsconfig.json')
  );
  const jsConfigWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(state.root, 'jsconfig.json')
  );

  const onLessEvent = (uri: vscode.Uri) => {
    scheduleIncrementalReload(state, uri.fsPath);
  };
  const onConfigEvent = () => {
    AutoImportService.clearAliasCache(state.root);
    scheduleFullReload(state);
  };

  lessWatcher.onDidChange(onLessEvent);
  lessWatcher.onDidCreate(onLessEvent);
  lessWatcher.onDidDelete(onLessEvent);

  tsConfigWatcher.onDidChange(onConfigEvent);
  tsConfigWatcher.onDidCreate(onConfigEvent);
  tsConfigWatcher.onDidDelete(onConfigEvent);

  jsConfigWatcher.onDidChange(onConfigEvent);
  jsConfigWatcher.onDidCreate(onConfigEvent);
  jsConfigWatcher.onDidDelete(onConfigEvent);

  state.watchers.push(lessWatcher, tsConfigWatcher, jsConfigWatcher);
}

function scheduleFullReload(state: WorkspaceIndexState, delay = 120) {
  if (!isWorkspaceStateActive(state)) {
    return;
  }
  state.pendingFullReload = true;
  armWorkTimer(state, delay);
}

function scheduleIncrementalReload(state: WorkspaceIndexState, filePath: string, delay = 120) {
  if (!isWorkspaceStateActive(state)) {
    return;
  }
  if (!state.pendingFullReload) {
    state.pendingChangedFiles.add(path.resolve(filePath));
  }
  armWorkTimer(state, delay);
}

function armWorkTimer(state: WorkspaceIndexState, delay: number) {
  if (state.workTimer) {
    clearTimeout(state.workTimer);
  }
  state.workTimer = setTimeout(() => {
    if (!isWorkspaceStateActive(state)) {
      return;
    }
    void flushScheduledIndexWork(state);
  }, delay);
}

function disposeWorkspaceState(workspaceRoot: string) {
  const normalizedRoot = path.resolve(workspaceRoot);
  const state = workspaceStates.get(normalizedRoot);
  if (!state) {
    return;
  }

  state.disposed = true;
  state.lifecycleToken += 1;

  state.watchers.forEach(watcher => watcher.dispose());
  state.watchers = [];

  if (state.workTimer) {
    clearTimeout(state.workTimer);
    state.workTimer = undefined;
  }

  for (const filePath of state.indexedFiles) {
    CacheManager.getInstance().removeCache(filePath);
  }
  state.indexedFiles.clear();

  state.pendingChangedFiles.clear();
  state.pendingFullReload = false;
  state.engine = undefined;
  state.hasBootstrappedIndex = false;

  AutoImportService.clearAliasCache(normalizedRoot);
  workspaceStates.delete(normalizedRoot);
}

function isWorkspaceStateActive(state: WorkspaceIndexState, lifecycleToken?: number): boolean {
  if (state.disposed) {
    return false;
  }
  if (workspaceStates.get(state.root) !== state) {
    return false;
  }
  if (typeof lifecycleToken === 'number' && lifecycleToken !== state.lifecycleToken) {
    return false;
  }
  return true;
}

function isPathInWorkspace(filePath: string, workspaceRoot: string): boolean {
  const normalizedFile = path.resolve(filePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(normalizedRoot + path.sep);
}

export function deactivate() {
  for (const root of [...workspaceStates.keys()]) {
    disposeWorkspaceState(root);
  }
  workspaceStates.clear();
  AutoImportService.clearAliasCache();
  CacheManager.getInstance().clearAll();
}
