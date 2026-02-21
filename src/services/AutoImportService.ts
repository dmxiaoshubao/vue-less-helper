import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LessImportService } from './LessImportService';

export class AutoImportService {
  public static readonly CREATE_EDIT_OPTIONS_DEFAULT = {
    allowCircularImport: false
  };
  /**
   * 检查文档中是否已经包含特定的 import 语句
   */
  public static hasImport(
    document: vscode.TextDocument,
    importPath: string,
    workspaceRoot?: string,
    targetUri?: string
  ): boolean {
    const text = document.getText();
    if (workspaceRoot && targetUri && document.uri?.fsPath) {
      return LessImportService.hasImportedTarget(text, targetUri, document.uri.fsPath, workspaceRoot);
    }

    const cleanText = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    return cleanText.includes(importPath);
  }

  /**
   * 生成自动导入对象的文本编辑
   */
  public static createImportEdit(
    document: vscode.TextDocument,
    importPath: string,
    workspaceRoot?: string,
    targetUri?: string,
    options: { allowCircularImport?: boolean } = AutoImportService.CREATE_EDIT_OPTIONS_DEFAULT
  ): vscode.TextEdit | undefined {
    const allowCircularImport = options.allowCircularImport === true;
    const currentFilePath = document.uri?.fsPath ? path.resolve(document.uri.fsPath) : '';
    const normalizedTargetUri = targetUri ? path.resolve(targetUri) : '';
    if (currentFilePath && normalizedTargetUri && currentFilePath === normalizedTargetUri) {
      return undefined;
    }
    if (!allowCircularImport && this.isUnsafeImportTarget(document, workspaceRoot, targetUri)) {
      return undefined;
    }

    if (this.hasImport(document, importPath, workspaceRoot, targetUri)) {
      return undefined;
    }

    // 确定插入位置：在 vue 文件中需寻找 <style lang="less"> 后的一行
    let insertLine = 0;
    if (document.languageId === 'vue') {
      const text = document.getText();
      const styleMatch = text.match(/<style[^>]*lang=["']less["'][^>]*>/);
      if (styleMatch && styleMatch.index !== undefined) {
        const preLines = text.substring(0, styleMatch.index).split('\n').length;
        insertLine = preLines; 
      } else {
        // 如果没有匹配到有效的 style less 标签，直接返回，不盲目插入
        return undefined;
      }
    }

    const importStatement = `@import (reference) '${importPath}';\n`;
    return vscode.TextEdit.insert(new vscode.Position(insertLine, 0), importStatement);
  }

  public static async createImportEditAsync(
    document: vscode.TextDocument,
    importPath: string,
    workspaceRoot?: string,
    targetUri?: string,
    options: { allowCircularImport?: boolean } = AutoImportService.CREATE_EDIT_OPTIONS_DEFAULT
  ): Promise<vscode.TextEdit | undefined> {
    const allowCircularImport = options.allowCircularImport === true;
    const currentFilePath = document.uri?.fsPath ? path.resolve(document.uri.fsPath) : '';
    const normalizedTargetUri = targetUri ? path.resolve(targetUri) : '';
    if (currentFilePath && normalizedTargetUri && currentFilePath === normalizedTargetUri) {
      return undefined;
    }
    if (!allowCircularImport && await this.isUnsafeImportTargetAsync(document, workspaceRoot, targetUri)) {
      return undefined;
    }

    if (this.hasImport(document, importPath, workspaceRoot, targetUri)) {
      return undefined;
    }

    let insertLine = 0;
    if (document.languageId === 'vue') {
      const text = document.getText();
      const styleMatch = text.match(/<style[^>]*lang=["']less["'][^>]*>/);
      if (styleMatch && styleMatch.index !== undefined) {
        const preLines = text.substring(0, styleMatch.index).split('\n').length;
        insertLine = preLines;
      } else {
        return undefined;
      }
    }

    const importStatement = `@import (reference) '${importPath}';\n`;
    return vscode.TextEdit.insert(new vscode.Position(insertLine, 0), importStatement);
  }

  /**
   * 自动在工作区配置别名的转换
   */
  public static resolveAliasPath(targetUri: string, workspaceRoot: string, currentFileUri?: string): string {
    if (!workspaceRoot) {
      if (!currentFileUri) return targetUri;
      const currentDir = path.dirname(currentFileUri);
      const relativePath = path.relative(currentDir, targetUri).replace(/\\/g, '/');
      return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
    }
    return LessImportService.buildImportPath(targetUri, workspaceRoot, currentFileUri);
  }

  public static clearAliasCache(workspaceRoot?: string) {
    LessImportService.clearAliasCache(workspaceRoot);
  }

  public static isUnsafeImportTarget(
    document: vscode.TextDocument,
    workspaceRoot: string | undefined,
    targetUri: string | undefined
  ): boolean {
    const currentFilePath = document.uri?.fsPath ? path.resolve(document.uri.fsPath) : '';
    const normalizedTargetUri = targetUri ? path.resolve(targetUri) : '';
    if (!currentFilePath || !normalizedTargetUri) {
      return false;
    }
    if (currentFilePath === normalizedTargetUri) {
      return true;
    }
    if (!workspaceRoot) {
      return false;
    }
    return this.wouldCreateCircularImport(normalizedTargetUri, currentFilePath, workspaceRoot);
  }

  public static async isUnsafeImportTargetAsync(
    document: vscode.TextDocument,
    workspaceRoot: string | undefined,
    targetUri: string | undefined
  ): Promise<boolean> {
    const currentFilePath = document.uri?.fsPath ? path.resolve(document.uri.fsPath) : '';
    const normalizedTargetUri = targetUri ? path.resolve(targetUri) : '';
    if (!currentFilePath || !normalizedTargetUri) {
      return false;
    }
    if (currentFilePath === normalizedTargetUri) {
      return true;
    }
    if (!workspaceRoot) {
      return false;
    }
    return this.wouldCreateCircularImportAsync(normalizedTargetUri, currentFilePath, workspaceRoot);
  }

  private static wouldCreateCircularImport(
    targetFile: string,
    currentFile: string,
    workspaceRoot: string
  ): boolean {
    const aliasConfig = LessImportService.getAliasConfig(workspaceRoot);
    return this.dependsOnFile(targetFile, currentFile, workspaceRoot, aliasConfig, new Set<string>());
  }

  private static dependsOnFile(
    sourceFile: string,
    targetFile: string,
    workspaceRoot: string,
    aliasConfig: Record<string, string>,
    visited: Set<string>
  ): boolean {
    const normalizedSource = path.resolve(sourceFile);
    const normalizedTarget = path.resolve(targetFile);
    if (normalizedSource === normalizedTarget) {
      return true;
    }
    if (visited.has(normalizedSource)) {
      return false;
    }
    visited.add(normalizedSource);

    if (!fs.existsSync(normalizedSource) || !fs.statSync(normalizedSource).isFile()) {
      return false;
    }

    let content = '';
    try {
      content = fs.readFileSync(normalizedSource, 'utf8');
    } catch {
      return false;
    }

    const imports = LessImportService.extractImportPaths(content);
    for (const importPath of imports) {
      const resolved = LessImportService.resolveImportPath(
        importPath,
        normalizedSource,
        workspaceRoot,
        aliasConfig
      );
      if (!resolved) {
        continue;
      }

      const normalizedResolved = path.resolve(resolved);
      if (normalizedResolved === normalizedTarget) {
        return true;
      }
      if (this.dependsOnFile(normalizedResolved, normalizedTarget, workspaceRoot, aliasConfig, visited)) {
        return true;
      }
    }

    return false;
  }

  private static async wouldCreateCircularImportAsync(
    targetFile: string,
    currentFile: string,
    workspaceRoot: string
  ): Promise<boolean> {
    const aliasConfig = LessImportService.getAliasConfig(workspaceRoot);
    return this.dependsOnFileAsync(
      targetFile,
      currentFile,
      workspaceRoot,
      aliasConfig,
      new Set<string>(),
      new Map<string, string[]>()
    );
  }

  private static async dependsOnFileAsync(
    sourceFile: string,
    targetFile: string,
    workspaceRoot: string,
    aliasConfig: Record<string, string>,
    visited: Set<string>,
    importCache: Map<string, string[]>
  ): Promise<boolean> {
    const normalizedSource = path.resolve(sourceFile);
    const normalizedTarget = path.resolve(targetFile);
    if (normalizedSource === normalizedTarget) {
      return true;
    }
    if (visited.has(normalizedSource)) {
      return false;
    }
    visited.add(normalizedSource);

    let resolvedImports = importCache.get(normalizedSource);
    if (!resolvedImports) {
      let stats: fs.Stats;
      try {
        stats = await fs.promises.stat(normalizedSource);
      } catch {
        return false;
      }
      if (!stats.isFile()) {
        return false;
      }

      let content = '';
      try {
        content = await fs.promises.readFile(normalizedSource, 'utf8');
      } catch {
        return false;
      }

      resolvedImports = LessImportService.extractImportPaths(content)
        .map(importPath =>
          LessImportService.resolveImportPath(importPath, normalizedSource, workspaceRoot, aliasConfig)
        )
        .filter((resolved): resolved is string => !!resolved)
        .map(resolved => path.resolve(resolved));
      importCache.set(normalizedSource, resolvedImports);
    }

    for (const normalizedResolved of resolvedImports) {
      if (normalizedResolved === normalizedTarget) {
        return true;
      }
      if (await this.dependsOnFileAsync(
        normalizedResolved,
        normalizedTarget,
        workspaceRoot,
        aliasConfig,
        visited,
        importCache
      )) {
        return true;
      }
    }

    return false;
  }
}
