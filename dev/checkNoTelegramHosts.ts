// Fails when a Telegram host name appears in the shipped app: TeleSignal sends no requests to Telegram. Web A is checked
// in its sources; Web K (`webk/`), whose vendored sources keep Telegram's code that the build leaves out, is checked in
// its built bundle, so run `npm run build:production` first to cover it.
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SCANNED_PATHS = ['src', 'public', 'index.html', 'vite.config.ts'];
const WEB_K_BUNDLE_PATH = join(process.env.BUILD_OUT_DIR || 'dist', 'k');
// Source maps carry the vendored sources, comments included; what runs is the code next to them
const RE_SKIPPED_FILE = /\.map$/;

// Telegram's domains, including those of its web apps, CDN, blog and Fragment
const TELEGRAM_DOMAINS = [
  'telegram.org', 'telegram.me', 'telegram.dog', 't.me', 'telesco.pe', 'fragment.com', 'telegra.ph',
  'cdn-telegram.org', 'telegram-cdn.org',
];

// Comments may cite Telegram's API documentation
const DOCUMENTATION_HOST = 'core.telegram.org';

const RE_ESCAPED_DOT = /\\\./g;
const DOMAIN_PATTERN = TELEGRAM_DOMAINS.map((domain) => domain.replaceAll('.', '\\.')).join('|');
const RE_HOST = new RegExp(`(?<![\\w-])(?:[\\w-]+\\.)*(?:${DOMAIN_PATTERN})(?![\\w-])`, 'gi');
const RE_COMMENT_START = /^\s*(?:\/\/|\/\*|\*|<!--|#)/;
const NUL_BYTE = 0;

type Finding = { path: string; line: number; host: string };

main();

function main() {
  const scannedPaths = [...SCANNED_PATHS];
  if (existsSync(join(ROOT, WEB_K_BUNDLE_PATH))) {
    scannedPaths.push(WEB_K_BUNDLE_PATH);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`${WEB_K_BUNDLE_PATH} is not built: Web K is not checked`);
  }

  const findings = scannedPaths
    .flatMap((path) => listFiles(join(ROOT, path)))
    .filter((path) => !RE_SKIPPED_FILE.test(path))
    .flatMap(checkFile);

  if (!findings.length) return;

  findings.forEach(({ path, line, host }) => {
    // eslint-disable-next-line no-console
    console.error(`${path}:${line}: ${host}`);
  });
  // eslint-disable-next-line no-console
  console.error(`\nTelegram hosts found: ${findings.length}. TeleSignal must not contact Telegram, see AGENTS.md`);
  process.exitCode = 1;
}

function listFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];

  return readdirSync(path).flatMap((name) => listFiles(join(path, name)));
}

function checkFile(absolutePath: string): Finding[] {
  const path = relative(ROOT, absolutePath).split(sep).join('/');
  const content = readFileSync(absolutePath);
  if (content.includes(NUL_BYTE)) return [];

  return content.toString('utf8').split('\n').flatMap((text, index) => {
    const normalized = text.replace(RE_ESCAPED_DOT, '.');

    return [...normalized.matchAll(RE_HOST)]
      .map(([host]) => host.toLowerCase())
      .filter((host) => !(host === DOCUMENTATION_HOST && isComment(normalized, host)))
      .map((host) => ({ path, line: index + 1, host }));
  });
}

function isComment(line: string, host: string) {
  const commentIndex = line.indexOf('//');
  const isAfterLineComment = commentIndex >= 0 && line.indexOf(host) > commentIndex && line[commentIndex - 1] !== ':';

  return RE_COMMENT_START.test(line) || isAfterLineComment;
}
