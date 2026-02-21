import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceService {
  /**
   * 检查当前工作区是否安装了 vue (在 dependencies 或 devDependencies 中)
   */
  public static async checkVueDependency(): Promise<boolean> {
    const depState = await this.readDependencyState();
    return depState.hasVue;
  }

  /**
   * 检查当前工作区是否安装了 less 相关依赖
   */
  public static async checkLessDependency(): Promise<boolean> {
    const depState = await this.readDependencyState();
    return depState.hasLess;
  }

  /**
   * 检查当前工作区是否可能使用 Vue 或 Less。
   * 没有 package.json 或读取失败时返回 true（保守策略，避免误伤）。
   */
  public static async checkVueOrLessDependency(): Promise<boolean> {
    const depState = await this.readDependencyState();
    if (depState.hasVue || depState.hasLess) {
      return true;
    }
    if (!depState.hasPackageJson) {
      return true;
    }
    return await this.hasLikelyVueOrLessSourceFiles();
  }

  /**
   * 判断当前文档是否为 Less 语境：
   * 1. .less 文档
   * 2. 含 <style lang="less"> 的 Vue SFC 文档
   */
  public static documentUsesLess(
    document: Pick<vscode.TextDocument, 'languageId' | 'getText'> | undefined
  ): boolean {
    if (!document) {
      return false;
    }
    if (document.languageId === 'less') {
      return true;
    }
    if (document.languageId !== 'vue') {
      return false;
    }
    const text = document.getText();
    if (!/<style\b/i.test(text)) {
      return false;
    }
    return /<style\b[^>]*\blang\s*=\s*["']less["'][^>]*>/i.test(text);
  }

  private static async readDependencyState(): Promise<{
    hasVue: boolean;
    hasLess: boolean;
    hasPackageJson: boolean;
  }> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return { hasVue: false, hasLess: false, hasPackageJson: false };
    }

    let hasVue = false;
    let hasLess = false;
    let hasPackageJson = false;

    for (const folder of workspaceFolders) {
      const packageJsonPath = path.join(folder.uri.fsPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        hasPackageJson = true;
        try {
          const content = await fs.promises.readFile(packageJsonPath, 'utf8');
          const pkg = JSON.parse(content);

          const allDeps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {})
          } as Record<string, string>;

          if (allDeps.vue) {
            hasVue = true;
          }
          if (allDeps.less || allDeps['less-loader']) {
            hasLess = true;
          }
          if (hasVue || hasLess) {
            return { hasVue, hasLess, hasPackageJson };
          }
        } catch (e) {
          console.error(`Error parsing package.json at ${packageJsonPath}:`, e);
          return { hasVue: true, hasLess: true, hasPackageJson: true };
        }
      }
    }

    return { hasVue, hasLess, hasPackageJson };
  }

  private static async hasLikelyVueOrLessSourceFiles(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }

    for (const folder of workspaceFolders) {
      if (await this.scanWorkspaceForVueOrLess(folder.uri.fsPath)) {
        return true;
      }
    }
    return false;
  }

  private static async scanWorkspaceForVueOrLess(workspaceRoot: string): Promise<boolean> {
    const maxDepth = 4;
    const maxEntries = 5000;
    const skipDirs = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'coverage', '.idea', '.vscode-test']);
    const stack: Array<{ dir: string; depth: number }> = [{ dir: workspaceRoot, depth: 0 }];
    let visited = 0;

    while (stack.length > 0 && visited < maxEntries) {
      const current = stack.pop()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        visited++;
        if (visited >= maxEntries) {
          break;
        }

        const fullPath = path.join(current.dir, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < maxDepth && !skipDirs.has(entry.name)) {
            stack.push({ dir: fullPath, depth: current.depth + 1 });
          }
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }
        if (entry.name.endsWith('.vue') || entry.name.endsWith('.less')) {
          return true;
        }
      }

      // 避免在超大工程扫描时长时间占用事件循环
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    return false;
  }
}
