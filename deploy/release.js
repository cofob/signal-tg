// Release helper for `.github/workflows/release.yml` and the maintainers; see `docs/RELEASING.md`.
//   node deploy/release.js check [tag]      Verifies that the version files, the tag and the changelog agree and
//                                           prints `key=value` lines (`tag`, `version`, `prerelease`)
//   node deploy/release.js notes <version>  Prints the release notes from `CHANGELOG.md`
//   node deploy/release.js bump <version>   Sets the version in every file and moves "Unreleased" to its section
// It needs only Node.js, so the release workflow runs it before installing any dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG_PATH = 'CHANGELOG.md';
const REPOSITORY_URL = 'https://github.com/cofob/telesignal';
const TAG_PREFIX = 'v';
const UNRELEASED = 'Unreleased';
const TUNNEL_PACKAGE = 'telesignal-tunnel';

// SemVer without build metadata, which the container image tag and the asset names cannot carry
const RE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const RE_SECTION_HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/;
const RE_LINK_REFERENCE = /^\[[^\]]+\]: \S+\s*$/;
const RE_BULLET = /^\s*[-*] \S/m;
const RE_LINE_BREAK = /\r?\n/;
const RE_LOCK_PACKAGE_INDENT = ' {4}"": \\{\\n {6}"name": "[^"]+",\\n {6}"version": "';

// Each pattern captures the text before the version, the version and the text after it
const VERSION_FILES = [
  { path: 'package.json', pattern: /^( {2}"version": ")([^"]+)(")/m },
  { path: 'package-lock.json', pattern: /^( {2}"version": ")([^"]+)(")/m },
  { path: 'package-lock.json', pattern: new RegExp(`("packages": \\{\\n${RE_LOCK_PACKAGE_INDENT})([^"]+)(")`) },
  { path: 'public/version.txt', pattern: /^()(\S+)(\s*)$/ },
  { path: 'proxy/Cargo.toml', pattern: getCargoPattern('\\[package\\]') },
  // The lockfiles of the crates that depend on the tunnel carry its version too
  { path: 'proxy/Cargo.lock', pattern: getCargoPattern('\\[\\[package\\]\\]') },
  { path: 'tauri/Cargo.lock', pattern: getCargoPattern('\\[\\[package\\]\\]') },
];

main();

function main() {
  const [command, argument] = process.argv.slice(2);

  try {
    switch (command) {
      case 'check':
        process.stdout.write(checkRelease(argument));
        break;
      case 'notes':
        process.stdout.write(`${getReleaseNotes(readText(CHANGELOG_PATH), requireArgument(argument))}\n`);
        break;
      case 'bump':
        bumpVersion(requireArgument(argument));
        break;
      default:
        throw new Error('Usage: node deploy/release.js check [tag] | notes <version> | bump <version>');
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

function requireArgument(argument) {
  if (!argument) throw new Error('The version is missing');

  return argument;
}

function getCargoPattern(tableHeader) {
  return new RegExp(`(${tableHeader}\\nname = "${TUNNEL_PACKAGE}"\\nversion = ")([^"]+)(")`);
}

function readText(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function getIsPrerelease(version) {
  return version.includes('-');
}

function checkRelease(tag) {
  const version = readVersions();
  if (!RE_SEMVER.test(version)) throw new Error(`"${version}" in package.json is not a SemVer version`);

  if (tag && tag !== `${TAG_PREFIX}${version}`) {
    throw new Error(`The tag ${tag} does not match ${version} in package.json, expected ${TAG_PREFIX}${version}`);
  }

  getReleaseNotes(readText(CHANGELOG_PATH), version);

  return `tag=${TAG_PREFIX}${version}\nversion=${version}\nprerelease=${getIsPrerelease(version)}\n`;
}

function readVersionEntries() {
  return VERSION_FILES.map(({ path, pattern }) => {
    const match = readText(path).match(pattern);
    if (!match) throw new Error(`${path} has no version to check`);

    return { path, version: match[2] };
  });
}

// Returns the version that every file carries; fails when they differ
function readVersions() {
  const entries = readVersionEntries();
  const expected = entries[0].version;
  const mismatches = entries.filter(({ version }) => version !== expected);
  if (mismatches.length) {
    const list = mismatches.map(({ path, version }) => `${path} has ${version}`).join(', ');
    throw new Error(`Versions differ from ${expected} of package.json: ${list}. Run \`npm run release:bump\`.`);
  }

  return expected;
}

// A stable release needs its own section. A pre-release without one is described by "Unreleased"
function getReleaseNotes(changelog, version) {
  const ownSection = getSection(changelog, version);
  if (ownSection && RE_BULLET.test(ownSection)) return ownSection;

  if (!getIsPrerelease(version)) {
    throw new Error(`${CHANGELOG_PATH} has no entries under "## [${version}]"`);
  }

  const unreleased = getSection(changelog, UNRELEASED);
  if (!unreleased || !RE_BULLET.test(unreleased)) {
    throw new Error(`${CHANGELOG_PATH} has no entries under "## [${version}]" or "## [${UNRELEASED}]"`);
  }

  return unreleased;
}

// Returns the text under `## [name]` up to the next section or the link references, or `undefined`
function getSection(changelog, name) {
  const lines = changelog.split(RE_LINE_BREAK);
  const start = lines.findIndex((line) => RE_SECTION_HEADING.exec(line)?.[1] === name);
  if (start === -1) return undefined;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => RE_SECTION_HEADING.test(line) || RE_LINK_REFERENCE.test(line));

  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

function bumpVersion(version) {
  if (!RE_SEMVER.test(version)) throw new Error(`"${version}" is not a SemVer version without build metadata`);

  // The files may disagree, as the tunnel crate does before the first release; bumping aligns them
  const entries = readVersionEntries();
  if (entries.every((entry) => entry.version === version)) throw new Error(`The version is ${version} already`);

  const changelog = readText(CHANGELOG_PATH);
  const unreleased = getSection(changelog, UNRELEASED);
  if (unreleased === undefined) throw new Error(`${CHANGELOG_PATH} has no "## [${UNRELEASED}]" section`);
  if (!RE_BULLET.test(unreleased)) throw new Error(`"## [${UNRELEASED}]" in ${CHANGELOG_PATH} has no entries`);
  if (getSection(changelog, version) !== undefined) throw new Error(`${CHANGELOG_PATH} has "## [${version}]" already`);

  // Group the edits per file: `package-lock.json` has two versions
  const paths = [...new Set(VERSION_FILES.map(({ path }) => path))];
  paths.forEach((path) => {
    const text = VERSION_FILES
      .filter((file) => file.path === path)
      .reduce((result, { pattern }) => result.replace(pattern, `$1${version}$3`), readText(path));
    writeFileSync(join(ROOT, path), text);
  });

  writeFileSync(join(ROOT, CHANGELOG_PATH), buildChangelog(changelog, version, new Date().toISOString().slice(0, 10)));

  process.stdout.write(`Bumped ${entries[0].version} to ${version}. Review the diff, commit it as "Release ${version}" `
    + `and tag it ${TAG_PREFIX}${version}.\n`);
}

function buildChangelog(changelog, version, date) {
  const lines = changelog.split(RE_LINE_BREAK);
  const unreleasedIndex = lines.findIndex((line) => RE_SECTION_HEADING.exec(line)?.[1] === UNRELEASED);
  const previousVersion = lines
    .slice(unreleasedIndex + 1)
    .map((line) => RE_SECTION_HEADING.exec(line)?.[1])
    .find(Boolean);

  // The released notes get their own heading; "Unreleased" stays above them, empty
  lines.splice(unreleasedIndex + 1, 0, '', `## [${version}] - ${date}`);

  const unreleasedLink = `[${UNRELEASED}]: ${REPOSITORY_URL}/compare/${TAG_PREFIX}${version}...HEAD`;
  const versionLink = previousVersion
    ? `[${version}]: ${REPOSITORY_URL}/compare/${TAG_PREFIX}${previousVersion}...${TAG_PREFIX}${version}`
    : `[${version}]: ${REPOSITORY_URL}/releases/tag/${TAG_PREFIX}${version}`;

  const linkIndex = lines.findIndex((line) => line.startsWith(`[${UNRELEASED}]: `));
  if (linkIndex === -1) {
    while (lines.at(-1) === '') lines.pop();
    lines.push('', unreleasedLink, versionLink);
  } else {
    lines.splice(linkIndex, 1, unreleasedLink, versionLink);
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
