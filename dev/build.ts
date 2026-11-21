// Builds both frontends into one directory (`BUILD_OUT_DIR`, `dist` by default): Web A in `a/`, Web K (`webk/`) in `k/`,
// and a root page that opens the default frontend (`plugins/frontends.ts`). Arguments go to Web A's build;
// `--sourcemap false` also leaves out Web K's source maps.
import { spawnSync } from 'child_process';
import { readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { DEFAULT_FRONTEND_PATH } from '../plugins/frontends.ts';

const ROOT = resolve(import.meta.dirname, '..');
const WEB_K_DIR = join(ROOT, 'webk');
const SOURCE_MAP_RE = /\.map$/;
// The root of the origin has no app of its own: `/` opens the default frontend, on any server and in the desktop app
const ROOT_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'">
  <meta http-equiv="refresh" content="0; url=${DEFAULT_FRONTEND_PATH}">
  <title>TeleSignal</title>
</head>
<body></body>
</html>
`;

const outDir = resolve(ROOT, process.env.BUILD_OUT_DIR || 'dist');
const webAArgs = process.argv.slice(2);
const hasNoSourceMaps = webAArgs.join(' ').includes('--sourcemap false');
// `tsx` turns Node's type stripping off for its children, which Web K's Vite config needs
const env = {
  ...process.env,
  NODE_OPTIONS: process.env.NODE_OPTIONS?.replace('--no-experimental-strip-types', '').trim(),
  BUILD_OUT_DIR: outDir,
};

rmSync(outDir, { recursive: true, force: true });
runVite(ROOT, ['build', ...webAArgs], {});
runVite(WEB_K_DIR, ['build'], { NODE_ENV: 'production' });
if (hasNoSourceMaps) removeSourceMaps(join(outDir, 'k'));
writeFileSync(join(outDir, 'index.html'), ROOT_PAGE);

// Each frontend builds with the Vite of its own dependencies
function runVite(cwd: string, args: string[], extraEnv: Record<string, string>) {
  const vite = join(cwd, 'node_modules/vite/bin/vite.js');
  const { status } = spawnSync(process.execPath, [vite, ...args], {
    cwd, env: { ...env, ...extraEnv }, stdio: 'inherit',
  });
  if (status !== 0) process.exit(status ?? 1);
}

function removeSourceMaps(dir: string) {
  readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      removeSourceMaps(path);
    } else if (SOURCE_MAP_RE.test(name)) {
      rmSync(path);
    }
  });
}
