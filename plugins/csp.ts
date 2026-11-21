/**
 * The app's Content-Security-Policy: the `<meta>` tag of `index.html`, the headers of the dev server, and the policy of
 * the desktop app (`app.security.csp` in `tauri/tauri.conf.json`, which a test keeps equal to the production policy
 * without a tunnel). A deployment that sends it as a response header runs `npm run csp:print`.
 */
// The page talks only to its own origin and the Signal tunnel. Users may pick any tunnel in the proxy settings
// (`SharedSettings.signalProxyUrl` and `signalSealedSenderProxyUrl`), so `connect-src` allows every `wss:` origin: the tunnel relays TLS that the WASM
// client terminates with Signal's certificate authority, so a wrong host cannot read traffic, but the policy no longer
// stops scripts from reaching other `wss:` servers. A local tunnel stays usable through `ws:` on `localhost` and
// `127.0.0.1`; CSP has no source expression for `[::1]`, so a tunnel there is blocked. `ipc:` and, on Windows,
// `http://ipc.localhost` carry the desktop app's in-process IPC, including the native transport's bytes.
export default function buildCsp(appEnv: string, tunnelUrl?: string) {
  const isDevelopment = appEnv === 'development';
  const tunnelOrigin = tunnelUrl ? new URL(tunnelUrl).origin : '';

  return `
  default-src 'self';
  connect-src 'self' ${tunnelOrigin} wss: ws://localhost:* ws://127.0.0.1:* blob: data: ipc: http://ipc.localhost;
  script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self'${isDevelopment ? ' blob:' : ''};
  style-src 'self' 'unsafe-inline';
  font-src 'self' data:;
  img-src 'self' data: blob:;
  media-src 'self' blob: data:;
  object-src 'none';
  frame-src 'none';
  base-uri 'none';
  form-action 'none';`
    .replace(/\s+/g, ' ').trim();
}
