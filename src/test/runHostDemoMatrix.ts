import * as path from 'path';
import { spawnSync } from 'child_process';

const DEMO_WORKSPACES = [
  'demo/basic',
  'demo/tsconfig-alias',
  'demo/jsconfig-alias',
  'demo/demo-multi-root.code-workspace'
];

function main() {
  const repoRoot = path.resolve(__dirname, '../../');
  for (const workspace of DEMO_WORKSPACES) {
    console.log(`[host-demo-matrix] running workspace: ${workspace}`);
    const result = spawnSync(
      process.execPath,
      [path.resolve(repoRoot, 'out/test/runHostTest.js')],
      {
        cwd: repoRoot,
        env: { ...process.env, HOST_TEST_WORKSPACE: workspace },
        stdio: 'inherit'
      }
    );

    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  }
}

main();
