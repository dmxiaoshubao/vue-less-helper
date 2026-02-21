import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

export type AliasConfig = Record<string, string>;

type AliasCacheEntry = {
  aliasConfig: AliasConfig;
};

export class LessImportService {
  private static aliasCache: Map<string, AliasCacheEntry> = new Map();

  public static clearAliasCache(workspaceRoot?: string) {
    if (workspaceRoot) {
      this.aliasCache.delete(path.resolve(workspaceRoot));
      return;
    }
    this.aliasCache.clear();
  }

  public static getAliasConfig(workspaceRoot: string): AliasConfig {
    if (!workspaceRoot) {
      return {};
    }

    const normalizedRoot = path.resolve(workspaceRoot);
    const cached = this.aliasCache.get(normalizedRoot);
    if (cached) {
      return cached.aliasConfig;
    }

    const aliasConfig = this.loadAliasConfig(normalizedRoot);
    this.aliasCache.set(normalizedRoot, { aliasConfig });
    return aliasConfig;
  }

  public static extractImportPaths(content: string): string[] {
    const clean = this.stripCommentsForImportScan(content);
    const paths: string[] = [];
    const importRegex = /@import\s*(?:\([^)]*\))?\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null = null;

    while ((match = importRegex.exec(clean)) !== null) {
      paths.push(match[1]);
    }

    return paths;
  }

  public static resolveImportPath(
    importPath: string,
    currentFilePath: string,
    workspaceRoot: string,
    aliasConfig?: AliasConfig
  ): string | null {
    const cleanPath = importPath.trim();
    if (!cleanPath || /^https?:\/\//i.test(cleanPath) || cleanPath.startsWith('//')) {
      return null;
    }

    const aliases = aliasConfig || this.getAliasConfig(workspaceRoot);
    const aliasEntries = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
    for (const [alias, aliasPath] of aliasEntries) {
      if (cleanPath === alias || cleanPath.startsWith(alias + '/')) {
        const relativePart = cleanPath === alias ? '' : cleanPath.slice(alias.length + 1);
        const resolved = this.resolveWithCandidates(path.join(aliasPath, relativePart));
        if (resolved) return resolved;
      }
    }

    if (cleanPath.startsWith('./') || cleanPath.startsWith('../')) {
      const resolved = this.resolveWithCandidates(path.resolve(path.dirname(currentFilePath), cleanPath));
      if (resolved) return resolved;
    }

    if (path.isAbsolute(cleanPath)) {
      const resolved = this.resolveWithCandidates(cleanPath);
      if (resolved) return resolved;
    }

    return null;
  }

  public static buildImportPath(
    targetUri: string,
    workspaceRoot: string,
    currentFileUri?: string
  ): string {
    const normalizedTarget = path.normalize(targetUri);
    const aliases = this.getAliasConfig(workspaceRoot);
    const aliasEntries = Object.entries(aliases).sort((a, b) => b[1].length - a[1].length);

    for (const [alias, aliasAbsPath] of aliasEntries) {
      const normalizedAliasPath = path.normalize(aliasAbsPath);
      if (normalizedTarget === normalizedAliasPath || normalizedTarget.startsWith(normalizedAliasPath + path.sep)) {
        const relativePart = path.relative(normalizedAliasPath, normalizedTarget).replace(/\\/g, '/');
        return relativePart ? `${alias}/${relativePart}` : alias;
      }
    }

    if (currentFileUri) {
      const relative = path.relative(path.dirname(currentFileUri), normalizedTarget).replace(/\\/g, '/');
      return relative.startsWith('.') ? relative : `./${relative}`;
    }

    const relativeToRoot = path.relative(workspaceRoot, normalizedTarget).replace(/\\/g, '/');
    return relativeToRoot.startsWith('.') ? relativeToRoot : `./${relativeToRoot}`;
  }

  public static hasImportedTarget(
    documentText: string,
    targetUri: string,
    currentFileUri: string,
    workspaceRoot: string
  ): boolean {
    const normalizedTarget = path.normalize(targetUri);
    const importPaths = this.extractImportPaths(documentText);
    const aliasConfig = this.getAliasConfig(workspaceRoot);

    for (const importPath of importPaths) {
      const resolved = this.resolveImportPath(importPath, currentFileUri, workspaceRoot, aliasConfig);
      if (resolved && path.normalize(resolved) === normalizedTarget) {
        return true;
      }
    }

    return false;
  }

  private static loadAliasConfig(workspaceRoot: string): AliasConfig {
    const aliasConfig: AliasConfig = {};
    const configFiles = ['tsconfig.json', 'jsconfig.json'];

    for (const configFile of configFiles) {
      const filePath = path.join(workspaceRoot, configFile);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const fromConfig = this.extractAliasConfigFromConfigFile(filePath, new Set<string>());
      Object.assign(aliasConfig, fromConfig);
    }

    return aliasConfig;
  }

  private static extractAliasConfigFromConfigFile(
    configFilePath: string,
    visited: Set<string>
  ): AliasConfig {
    const normalizedConfig = path.resolve(configFilePath);
    if (visited.has(normalizedConfig)) {
      return {};
    }
    visited.add(normalizedConfig);

    let parsed: {
      extends?: string;
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    } = {};
    try {
      parsed = JSON5.parse(fs.readFileSync(normalizedConfig, 'utf8')) as {
        extends?: string;
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
    } catch {
      return {};
    }

    let aliasConfig: AliasConfig = {};
    const extendsPath = this.resolveExtendsPath(parsed.extends, path.dirname(normalizedConfig));
    if (extendsPath) {
      aliasConfig = this.extractAliasConfigFromConfigFile(extendsPath, visited);
    }

    const baseUrl = parsed.compilerOptions?.baseUrl || '.';
    const paths = parsed.compilerOptions?.paths || {};
    const baseDir = path.resolve(path.dirname(normalizedConfig), baseUrl);
    for (const [aliasPattern, targets] of Object.entries(paths)) {
      if (!targets || targets.length === 0) {
        continue;
      }
      const alias = aliasPattern.replace(/\/\*$/, '');
      const target = targets[0].replace(/\/\*$/, '');
      aliasConfig[alias] = path.resolve(baseDir, target);
    }

    return aliasConfig;
  }

  private static resolveExtendsPath(rawExtends: string | undefined, configDir: string): string | null {
    if (!rawExtends || typeof rawExtends !== 'string') {
      return null;
    }

    const candidates: string[] = [];
    if (rawExtends.startsWith('.') || rawExtends.startsWith('/') || rawExtends.startsWith('..')) {
      const abs = path.resolve(configDir, rawExtends);
      candidates.push(abs);
      candidates.push(`${abs}.json`);
    } else {
      try {
        const resolved = require.resolve(rawExtends, { paths: [configDir] });
        candidates.push(resolved);
      } catch {
        // ignore unresolved package-style extends
      }
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    }
    return null;
  }

  private static resolveWithCandidates(basePath: string): string | null {
    const candidates: string[] = [];
    candidates.push(basePath);

    if (!path.extname(basePath)) {
      candidates.push(`${basePath}.less`);
      candidates.push(path.join(basePath, 'index.less'));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    }

    return null;
  }

  private static stripCommentsForImportScan(text: string): string {
    let result = '';
    let i = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    while (i < text.length) {
      const ch = text[i];
      const next = text[i + 1];
      const prev = i > 0 ? text[i - 1] : ' ';

      if (inLineComment) {
        if (ch === '\n' || ch === '\r') {
          inLineComment = false;
          result += ch;
        } else {
          result += ' ';
        }
        i++;
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          result += '  ';
          i += 2;
          continue;
        }
        result += ch === '\n' || ch === '\r' ? ch : ' ';
        i++;
        continue;
      }

      if (inSingleQuote) {
        result += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '\'') {
          inSingleQuote = false;
        }
        i++;
        continue;
      }

      if (inDoubleQuote) {
        result += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inDoubleQuote = false;
        }
        i++;
        continue;
      }

      if (ch === '\'') {
        inSingleQuote = true;
        result += ch;
        i++;
        continue;
      }

      if (ch === '"') {
        inDoubleQuote = true;
        result += ch;
        i++;
        continue;
      }

      if (ch === '/' && next === '*') {
        inBlockComment = true;
        result += '  ';
        i += 2;
        continue;
      }

      if (ch === '/' && next === '/' && /[\s{(;,]/.test(prev)) {
        inLineComment = true;
        result += '  ';
        i += 2;
        continue;
      }

      result += ch;
      i++;
    }

    return result;
  }
}
