import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

type HostExtMode = 'isolated' | 'with-vue';
type SupportedLangExtensionId = 'vue.volar' | 'octref.vetur';
const DEFAULT_LANG_EXTENSION_PRIORITY: SupportedLangExtensionId[] = ['vue.volar', 'octref.vetur'];

function resolveHostExtMode(): HostExtMode {
    const mode = (process.env.HOST_TEST_EXT_MODE || 'isolated').trim().toLowerCase();
    return mode === 'with-vue' ? 'with-vue' : 'isolated';
}

function parseSupportedLangExtensionId(raw: string): SupportedLangExtensionId | undefined {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'vue.volar') return 'vue.volar';
    if (normalized === 'octref.vetur') return 'octref.vetur';
    return undefined;
}

function resolvePreferredLangExtensionIds(): SupportedLangExtensionId[] {
    const explicit = (process.env.HOST_TEST_LANG_EXT_ID || process.env.HOST_TEST_VUE_EXT_ID || '').trim();
    if (!explicit) {
        return DEFAULT_LANG_EXTENSION_PRIORITY;
    }

    const parsed = parseSupportedLangExtensionId(explicit);
    if (!parsed) {
        throw new Error(
            `Unsupported HOST_TEST_LANG_EXT_ID="${explicit}". ` +
            'Supported values: vue.volar, octref.vetur.'
        );
    }
    return [parsed];
}

function resolveExtensionsRootDir(): string | undefined {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return undefined;
    return process.env.HOST_TEST_EXTENSIONS_SOURCE_DIR
        ? path.resolve(process.env.HOST_TEST_EXTENSIONS_SOURCE_DIR)
        : path.join(home, '.vscode', 'extensions');
}

function getExtensionFolderPrefix(extensionId: SupportedLangExtensionId): string {
    return extensionId.toLowerCase();
}

function parseExtensionVersionFromFolder(name: string, extensionId: SupportedLangExtensionId): string | undefined {
    const prefix = getExtensionFolderPrefix(extensionId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${prefix}-(.+)$`, 'i').exec(name);
    return match?.[1];
}

function assertExpectedExtensionDir(
    extensionDir: string,
    expectedExtensionIds: SupportedLangExtensionId[]
): SupportedLangExtensionId {
    if (!fs.existsSync(extensionDir) || !fs.statSync(extensionDir).isDirectory()) {
        throw new Error(`Language extension directory does not exist: ${extensionDir}`);
    }

    const pkgPath = path.join(extensionDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        throw new Error(`Missing package.json in extension directory: ${extensionDir}`);
    }

    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { publisher?: string; name?: string };
    const extensionIdRaw = `${pkg.publisher || ''}.${pkg.name || ''}`.toLowerCase();
    const parsed = parseSupportedLangExtensionId(extensionIdRaw);
    if (!parsed || !expectedExtensionIds.includes(parsed)) {
        throw new Error(
            `Expected ${expectedExtensionIds.join(' or ')} extension, got "${extensionIdRaw || 'unknown'}" from ${extensionDir}`
        );
    }
    return parsed;
}

function resolveInstalledVueExtensionDir(): { extensionDir: string; extensionId: SupportedLangExtensionId } | undefined {
    const preferredExtensionIds = resolvePreferredLangExtensionIds();
    const explicitPath = (process.env.HOST_TEST_LANG_EXT_PATH || process.env.HOST_TEST_VUE_EXT_PATH)?.trim();
    if (explicitPath) {
        const resolved = path.resolve(explicitPath);
        const extensionId = assertExpectedExtensionDir(resolved, preferredExtensionIds);
        return { extensionDir: resolved, extensionId };
    }

    const extensionsDir = resolveExtensionsRootDir();
    if (!extensionsDir) return undefined;
    if (!fs.existsSync(extensionsDir)) return undefined;

    const pinnedVersion = (process.env.HOST_TEST_LANG_EXT_VERSION || process.env.HOST_TEST_VUE_EXT_VERSION)?.trim();
    const allEntries = fs.readdirSync(extensionsDir);
    for (const targetExtensionId of preferredExtensionIds) {
        const folderPrefix = getExtensionFolderPrefix(targetExtensionId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const candidates = allEntries
            .filter(
                (name) =>
                    new RegExp(`^${folderPrefix}-`, 'i').test(name) &&
                    (!pinnedVersion || parseExtensionVersionFromFolder(name, targetExtensionId) === pinnedVersion)
            )
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

        if (candidates.length === 0) {
            continue;
        }

        const picked = path.join(extensionsDir, candidates[0]);
        const extensionId = assertExpectedExtensionDir(picked, [targetExtensionId]);
        return { extensionDir: picked, extensionId };
    }
    return undefined;
}

async function main() {
    const tempDirs: string[] = [];
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './host/index');
        const workspacePath = resolveWorkspacePath(extensionDevelopmentPath);
        const launchArgs = [workspacePath];
        const mode = resolveHostExtMode();
        const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vuex-helper-host-user-'));
        tempDirs.push(isolatedUserDataDir);
        launchArgs.push('--user-data-dir', isolatedUserDataDir);

        if (mode === 'isolated') {
            launchArgs.push('--disable-extensions');
        } else {
            const langExtension = resolveInstalledVueExtensionDir();
            if (!langExtension) {
                throw new Error(
                    'HOST_TEST_EXT_MODE=with-vue requires vue.volar or octref.vetur (priority: vue.volar -> octref.vetur). ' +
                    'You can set HOST_TEST_LANG_EXT_PATH=/abs/path/to/<publisher.name>-x.y.z ' +
                    'or HOST_TEST_LANG_EXT_VERSION=x.y.z. To force one extension, set HOST_TEST_LANG_EXT_ID.'
                );
            }

            const isolatedExtensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vuex-helper-host-ext-'));
            tempDirs.push(isolatedExtensionsDir);

            const targetDir = path.join(isolatedExtensionsDir, path.basename(langExtension.extensionDir));
            fs.cpSync(langExtension.extensionDir, targetDir, { recursive: true });

            launchArgs.push('--extensions-dir', isolatedExtensionsDir);
            console.log(`[host-test] with-vue mode: loaded ${path.basename(langExtension.extensionDir)} only (target=${langExtension.extensionId})`);
        }

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs
        });
    } catch (err) {
        console.error(err);
        console.error('Failed to run host integration tests');
        process.exit(1);
    } finally {
        for (const dir of tempDirs) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                // Best-effort cleanup for temporary host test folders.
            }
        }
    }
}

function resolveWorkspacePath(extensionDevelopmentPath: string): string {
    const raw = (process.env.HOST_TEST_WORKSPACE || '').trim();
    if (!raw) {
        return path.resolve(extensionDevelopmentPath, 'demo/basic');
    }
    if (path.isAbsolute(raw)) {
        return raw;
    }
    return path.resolve(extensionDevelopmentPath, raw);
}

main();
