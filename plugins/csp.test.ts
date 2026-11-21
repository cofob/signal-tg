import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';

import buildCsp from './csp.ts';

describe('Content-Security-Policy', () => {
  test('the desktop app uses the production policy', () => {
    const config = JSON.parse(readFileSync('tauri/tauri.conf.json', 'utf8')) as { app: { security: { csp: string } } };

    expect(config.app.security.csp).toBe(buildCsp('production'));
  });

  test('allows no inline or dynamic script and no frames', () => {
    const csp = buildCsp('production', 'wss://tunnel.example/tunnel');

    expect(csp).toContain('script-src \'self\' \'wasm-unsafe-eval\';');
    expect(csp).not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval'|\*)/);
    expect(csp).toContain('frame-src \'none\'');
    expect(csp).toContain('worker-src \'self\';');
    expect(csp).toContain('connect-src \'self\' wss://tunnel.example wss:');
  });

  test('lets the development server use blob workers only', () => {
    expect(buildCsp('development')).toContain('worker-src \'self\' blob:;');
    expect(buildCsp('production')).toContain('worker-src \'self\';');
  });
});
