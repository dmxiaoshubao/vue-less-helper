const noopDisposable = { dispose() {} };

const defaultConfigStore: Record<string, unknown> = {
  'vueLessHelper.lessFiles': [],
  'vueLessHelper.notice': true,
  'less.files': [],
  'less.notice': true,
  'less.suppressNotice': false
};
const explicitConfigStore: Record<string, unknown> = {};

function configKey(section?: string, key?: string): string {
  if (section && key) {
    return `${section}.${key}`;
  }
  if (section) {
    return section;
  }
  return key || '';
}

function getConfigValue(section?: string, key?: string, defaultValue?: unknown) {
  const exactKey = configKey(section, key);
  if (Object.prototype.hasOwnProperty.call(explicitConfigStore, exactKey)) {
    return explicitConfigStore[exactKey];
  }
  if (Object.prototype.hasOwnProperty.call(defaultConfigStore, exactKey)) {
    return defaultConfigStore[exactKey];
  }
  if (!section && key) {
    if (Object.prototype.hasOwnProperty.call(explicitConfigStore, key)) {
      return explicitConfigStore[key];
    }
    if (Object.prototype.hasOwnProperty.call(defaultConfigStore, key)) {
      return defaultConfigStore[key];
    }
  }
  return defaultValue;
}

function setConfigValue(section: string | undefined, key: string, value: unknown) {
  const fullKey = configKey(section, key);
  if (value === undefined) {
    delete explicitConfigStore[fullKey];
    return;
  }
  explicitConfigStore[fullKey] = value;
}

function inspectConfigValue(section?: string, key?: string) {
  const fullKey = configKey(section, key);
  const explicitExists = Object.prototype.hasOwnProperty.call(explicitConfigStore, fullKey);
  return {
    key: fullKey,
    defaultValue: getConfigValue(section, key),
    globalValue: undefined,
    workspaceValue: explicitExists ? explicitConfigStore[fullKey] : undefined,
    workspaceFolderValue: explicitExists ? explicitConfigStore[fullKey] : undefined
  };
}

module.exports = {
  workspace: {
    getConfiguration: (section?: string) => {
      return {
        get: (key?: string, defaultValue?: unknown) => getConfigValue(section, key, defaultValue),
        inspect: (key?: string) => inspectConfigValue(section, key),
        update: (key: string, value: unknown) => {
          setConfigValue(section, key, value);
          return Promise.resolve();
        }
      };
    },
    workspaceFolders: [],
    getWorkspaceFolder: () => undefined,
    onDidOpenTextDocument: () => noopDisposable,
    onDidChangeConfiguration: () => noopDisposable
  },
  Uri: {
    file: (f: string) => ({ fsPath: f, path: f, scheme: 'file' }),
    parse: (f: string) => ({ fsPath: f, path: f, scheme: 'file' })
  },
  Position: class Position {
    constructor(public line: number, public character: number) {}
    isBefore(other: any) { return this.line < other.line || (this.line === other.line && this.character < other.character); }
    isAfter(other: any) { return this.line > other.line || (this.line === other.line && this.character > other.character); }
  },
  Range: class Range {
    constructor(public start: any, public end: any) {}
  },
  Location: class Location {
    constructor(public uri: any, public rangeOrPosition: any) {}
  },
  CompletionItem: class CompletionItem {
    constructor(public label: string, public kind?: any) {}
  },
  CompletionItemKind: {
    Variable: 1,
    Method: 2,
    Class: 3,
    Color: 4,
  },
  SnippetString: class SnippetString {
    constructor(public value: string) {}
  },
  Hover: class Hover {
    public contents: any[];
    constructor(contents: any | any[], public range?: any) {
      this.contents = Array.isArray(contents) ? contents : [contents];
    }
  },
  MarkdownString: class MarkdownString {
    public value: string;
    constructor(value?: string) { this.value = value || ''; }
    appendMarkdown(v: string) { this.value += v; return this; }
    appendCodeblock(v: string, lang: string) { this.value += `\n\`\`\`${lang}\n${v}\n\`\`\`\n`; return this; }
  },
  TextEdit: {
    insert: (position: any, newText: string) => ({ range: { start: position, end: position }, newText })
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showOpenDialog: () => Promise.resolve(undefined),
    onDidChangeActiveTextEditor: () => noopDisposable
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  __setConfiguration: (key: string, value: unknown) => {
    if (value === undefined) {
      delete explicitConfigStore[key];
      return;
    }
    explicitConfigStore[key] = value;
  },
  __getConfiguration: (key: string) => (
    Object.prototype.hasOwnProperty.call(explicitConfigStore, key)
      ? explicitConfigStore[key]
      : defaultConfigStore[key]
  ),
  __resetConfiguration: () => {
    Object.keys(explicitConfigStore).forEach(key => delete explicitConfigStore[key]);
  }
};
