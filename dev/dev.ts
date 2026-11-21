// `npm run dev`: both frontends on one port. Web A's server listens on `DEV_PORT` (1234) at `/a/`, sends `/` to the default frontend
// and proxies `/k/` to Web K's server, which listens on `WEBK_DEV_PORT` (the next port)
import { type ChildProcess, spawn } from 'child_process';
import { resolve } from 'path';

const DEFAULT_DEV_PORT = 1234;
const ROOT = resolve(import.meta.dirname, '..');

const devPort = Number(process.env.DEV_PORT) || DEFAULT_DEV_PORT;
const webKDevPort = Number(process.env.WEBK_DEV_PORT) || devPort + 1;
const env = {
  ...process.env,
  // `tsx` turns Node's type stripping off for its children, which Web K's Vite config needs
  NODE_OPTIONS: process.env.NODE_OPTIONS?.replace('--no-experimental-strip-types', '').trim(),
  APP_ENV: process.env.APP_ENV || 'development',
  DEV_PORT: String(devPort),
  WEBK_DEV_PORT: String(webKDevPort),
};

const children: ChildProcess[] = [
  start('webk', [], resolve(ROOT, 'webk'), { NODE_ENV: 'development', DEV_PUBLIC_PORT: String(devPort) }),
  start('weba', ['--mode', 'development'], ROOT, {}),
];

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

// Each frontend runs the Vite of its own dependencies
function start(name: string, args: string[], cwd: string, extraEnv: Record<string, string>) {
  const vite = resolve(cwd, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, ...args], { cwd, env: { ...env, ...extraEnv }, stdio: 'inherit' });
  child.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.log(`[dev] ${name} exited with ${code}`);
    stopAll();
  });
  return child;
}

function stopAll() {
  children.forEach((child) => {
    // A child that exited already ignores the signal
    child.kill('SIGTERM');
  });
}
