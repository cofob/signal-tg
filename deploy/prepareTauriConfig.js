// Tauri configuration overrides for release builds (`.github/workflows/desktop.yml`), from environment variables.
// Prints the JSON for `tauri build --config` when run as a script.
import { pathToFileURL } from 'node:url';

export default function prepareTauriConfig() {
  const {
    UPDATER_ENDPOINT, UPDATER_PUBLIC_KEY, APPLE_SIGNING_IDENTITY, KEYPAIR_ALIAS,
  } = process.env;
  const config = {
    bundle: {
      macOS: {},
      windows: {},
    },
  };

  // The updater stays off unless both are set: the app then checks only this endpoint
  if (UPDATER_ENDPOINT && UPDATER_PUBLIC_KEY) {
    config.plugins = {
      updater: {
        endpoints: [UPDATER_ENDPOINT],
        pubkey: UPDATER_PUBLIC_KEY,
      },
    };
    config.bundle.createUpdaterArtifacts = true;
  }

  // Without a Developer ID certificate the app is signed ad hoc, which Apple silicon requires to run it
  if (!APPLE_SIGNING_IDENTITY) {
    config.bundle.macOS.signingIdentity = '-';
  }

  if (KEYPAIR_ALIAS) {
    config.bundle.windows.signCommand = `smctl.exe sign --keypair-alias=${KEYPAIR_ALIAS} --simple --input %1`;
  }

  return config;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(prepareTauriConfig()));
}
