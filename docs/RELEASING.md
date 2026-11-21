# Continuous integration and releases

## Workflows

| Workflow | Runs on | What it does |
| --- | --- | --- |
| `ci.yml` | Pushes to branches, pull requests, manual runs | Web app: `npm run check:ts` (types and ESLint), `npm run check:css`, `npm run check:hosts`, `npm test`, generated localization types and protobuf code match the sources, `npm run build:production` (uploads `dist` as the `telesignal-web` artifact). Rust: `proxy/` (rustfmt, Clippy with and without the server feature, tests), `tauri/` (rustfmt, Clippy, tests), `rust/signal-wasm` (rebuilds the WebAssembly module and compares the bindings). `CI success` is the one check to require on the default branch |
| `changelog.yml` | Pull requests | Fails a pull request that changes the shipped app (`src/`, `public/`, `proxy/`, `tauri/`, `rust/`) without a `CHANGELOG.md` entry. Waive it with the label `skip changelog`; titles starting with `[CI]`, `[Dev]` or `Docs` and Dependabot need no entry |
| `security.yml` | Weekly, manual runs, lockfile changes | `npm audit` for the packages in the bundle and `cargo audit` for `proxy/`, `tauri/` and `rust/signal-wasm` |
| `release.yml` | Tags `v*`, manual runs | Builds and publishes a release, see below |
| `desktop.yml` | Called by `release.yml`, manual runs | Builds the desktop packages for macOS, Windows and Linux; see `tauri/README.md` |

Rust jobs run only when their files change; manual runs run everything. A newer push to a branch cancels the run
of the older one, except on the default branch. The Rust toolchain is pinned in `RUST_TOOLCHAIN` of `ci.yml` and
`release.yml`; keep it in line with `rust/signal-wasm/rust-toolchain`. Dependabot proposes weekly updates of the npm
packages, the crates of `proxy/` and `tauri/`, the Docker base images and the actions. `rust/signal-wasm` follows the
vendored libsignal and changes with it (`rust/libsignal/NOTICE.md`).

The WebAssembly binary in `src/lib/signal/wasm/generated` embeds the paths of the machine that built it, so a rebuild
on another machine differs from the committed file. CI therefore compares only the JavaScript glue and the type
declarations, which depend on the exported functions alone; commit the output of `npm run signal:wasm` whenever the
exports change.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Add a line for every change that
users notice under `## [Unreleased]`, in `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` or
`### Security`, in the pull request that makes the change. Describe what users see, not how the code changed.

## Version

The version lives in `package.json`, `package-lock.json`, `public/version.txt` and the `telesignal-tunnel` crate
(`proxy/Cargo.toml` and the lockfiles that name it); the desktop app takes it from `package.json`. Do not edit the files
by hand and do not use `npm version`. Releases use [Semantic Versioning](https://semver.org/) without build
metadata: `0.2.0`, or `0.2.0-rc.1` for a pre-release.

## Releasing

1. Make sure `## [Unreleased]` in `CHANGELOG.md` lists the changes.
2. On the default branch: `npm run release:bump -- 0.2.0`. It sets the version in every file and moves the
   "Unreleased" entries under `## [0.2.0] - <date>`. Check the diff and tidy the notes.
3. Commit as `Release 0.2.0` and push.
4. Tag the commit and push the tag: `git tag -a v0.2.0 -m "TeleSignal 0.2.0" && git push origin v0.2.0`.

The tag starts `release.yml`. It stops before building anything unless the tag equals `v` plus the version in every
file, the changelog has entries for the version, and, for a stable version, the commit is on the default branch
(`npm run release:check -- v0.2.0` runs the same check locally). Then it:

- creates a draft release whose notes are the changelog section of the version (`npm run release:notes -- 0.2.0`);
- builds the web bundle `telesignal-web-<version>.tar.gz` (static files; the page needs a reverse proxy that serves the
  tunnel at `/tunnel`, see `proxy/README.md`);
- builds the tunnel `telesignal-tunnel-<version>-<target>` for Linux (static musl, x86_64 and aarch64), macOS (Apple
  silicon and Intel) and Windows, and starts each native build to check `/health`;
- publishes the container image `ghcr.io/<owner>/telesignal-tunnel` for `linux/amd64` and `linux/arm64`, tagged
  `<version>`, `<major>.<minor>` and `<major>` and, for a stable version, `latest`; the release tags appear only after
  both platforms answered `/health`;
- builds the desktop packages (`.dmg`, `.app.tar.gz`, NSIS `.exe`, `.deb`, `.AppImage`) through `desktop.yml` and
  attaches them to the draft;
- writes `SHA256SUMS` over every asset, attests their build provenance and publishes the release.

Assets go to a draft release, and the release becomes visible only when every job succeeded. If a job fails, fix the
cause and rerun the failed jobs, or start `release.yml` manually with the same tag (select the tag as the workflow
ref); the draft is completed and its notes are refreshed. A published release is never changed.

A tag pushed with the workflow token starts no workflows. Automation that creates tags that way calls `release.yml`
as a reusable workflow (`uses: ./.github/workflows/release.yml` with `tag`) and grants `contents`, `packages`,
`id-token` and `attestations` write access.

### Pre-releases

A tag with a suffix, such as `v0.2.0-rc.1`, publishes a pre-release: it is never marked as the latest release, the
image gets only the full version tag, and the commit may be on any branch. Its notes are the version's own changelog
section, or "Unreleased" when it has none, so a release candidate can be cut without moving the entries.

### Signing and updates

Signing, notarization and the updater are optional and turn on when the secrets and variables listed in
`tauri/README.md` exist. Without them the packages are unsigned (macOS builds are signed ad hoc).

### Container image visibility

GitHub creates a package private on its first push. Make `telesignal-tunnel` public in the package settings once, and
link it to the repository, so that anyone can pull it.
