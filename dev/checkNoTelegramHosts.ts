// Fails when a Telegram host name appears in the shipped app: TeleSignal sends no requests to Telegram
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SCANNED_PATHS = ['src', 'public', 'index.html', 'vite.config.ts'];

// Telegram's domains, including those of its web apps, CDN, blog and Fragment
const TELEGRAM_DOMAINS = [
  'telegram.org', 'telegram.me', 'telegram.dog', 't.me', 'telesco.pe', 'fragment.com', 'telegra.ph',
  'cdn-telegram.org', 'telegram-cdn.org',
];

// Each entry is removed by a planned change, so the list only shrinks
const ALLOWED_DIRECTORIES = [
  // GramJS is in the bundle but no longer called; plan stage 3 deletes it with its data center hosts
  'src/lib/gramjs/',
  'src/api/gramjs/',
  // Vendored widget runtime (kept unchanged, see its `NOTICE.md`): its SDK policy validates links that widgets ask
  // the client to open, and the client only follows `tg:` links; it is deleted with bots and Mini Apps
  'src/lib/widget-sandbox/',
];

// Comments may cite Telegram's API documentation, which ported code follows
const DOCUMENTATION_HOST = 'core.telegram.org';

const RE_ESCAPED_DOT = /\\\./g;
const DOMAIN_PATTERN = TELEGRAM_DOMAINS.map((domain) => domain.replaceAll('.', '\\.')).join('|');
const RE_HOST = new RegExp(`(?<![\\w-])(?:[\\w-]+\\.)*(?:${DOMAIN_PATTERN})(?![\\w-])`, 'gi');
const RE_COMMENT_START = /^\s*(?:\/\/|\/\*|\*|<!--|#)/;
const NUL_BYTE = 0;

type Finding = { path: string; line: number; host: string };

main();

function main() {
  const findings = SCANNED_PATHS.flatMap((path) => listFiles(join(ROOT, path))).flatMap(checkFile);

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
  if (ALLOWED_DIRECTORIES.some((directory) => path.startsWith(directory))) return [];

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
