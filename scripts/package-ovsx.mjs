// Builds the Open VSX Registry package: Extension-Versions/open-vsx/<name>-<version>.vsix
// (used by `make ovsx`). Same extension as the Marketplace build, kept in its own folder so
// it is clear what was published to open-vsx.org and what was published to the Marketplace.
//
//   node scripts/package-ovsx.mjs [--force] [--out <dir>] [--publish]
//
// --force    overwrite an existing VSIX of this version (by default it refuses: it may already be published)
// --out      output directory (default: Extension-Versions/open-vsx)
// --publish  after packaging, publish with `ovsx` using the OVSX_PAT environment variable
//
// Before the first publish the namespace has to exist on open-vsx.org and the Eclipse
// Publisher Agreement has to be signed; the script says so when the namespace is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const publish = args.includes('--publish');
const outIndex = args.indexOf('--out');
const outDir = resolve(root, outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : 'Extension-Versions/open-vsx');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { name, version, publisher } = pkg;
if (!publisher) fail('package.json has no "publisher"; Open VSX needs it as the namespace.');

const outFile = join(outDir, `${name}-${version}.vsix`);
const rel = relative(root, outFile);
const shown = rel.startsWith('..') ? outFile : rel;

// Files that must end up inside the VSIX (see .vscodeignore). vsce lowercases README and
// CHANGELOG and gives LICENSE a suffix, so names are compared in lower case and the license
// is matched with or without one.
const REQUIRED = ['extension/package.json', 'extension/readme.md', 'extension/changelog.md', 'extension/icons/icon.png', 'extension/dist/extension.js', 'extension/dist/webview.js', 'extension/dist/webview.css', 'extension/dist/codicons/codicon.css'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(label, command) {
  console.log(`\n> ${label}`);
  // A single command string: npm/npx are .cmd files on Windows and need a shell.
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) fail(`\n${label} failed.`);
}

// open-vsx.org answers with JSON for a known extension and with an "error" field otherwise,
// so a failed request must never block packaging - it is only a warning.
async function openVsxState() {
  const get = async (url) => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      return res.ok ? await res.json() : undefined;
    } catch {
      return undefined;
    }
  };
  const namespace = await get(`https://open-vsx.org/api/${publisher}`);
  const latest = await get(`https://open-vsx.org/api/${publisher}/${name}`);
  const thisVersion = await get(`https://open-vsx.org/api/${publisher}/${name}/${version}`);
  return {
    namespaceExists: Boolean(namespace && !namespace.error),
    latestVersion: latest && !latest.error ? latest.version : undefined,
    alreadyPublished: Boolean(thisVersion && !thisVersion.error),
  };
}

// Reads the file names out of a zip (VSIX) without unpacking it: end-of-central-directory
// record, then every central directory entry.
function zipEntries(file) {
  const buf = readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && eocd < 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) eocd = i;
  if (eocd < 0) fail(`${shown} is not a valid zip archive.`);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    names.push(buf.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// Open VSX does not rewrite relative links the way the Marketplace does, so every image
// in the README has to be an absolute https URL.
function relativeReadmeImages() {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  return [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]).filter((url) => !/^https:\/\//.test(url));
}

if (existsSync(outFile) && !force) {
  fail(`${shown} already exists. Bump "version" in package.json, or run \`make ovsx FORCE=1\` to overwrite it.`);
}

const state = await openVsxState();
if (state.alreadyPublished && !force) {
  fail(`${publisher}.${name} ${version} is already on open-vsx.org. Bump "version" in package.json, or pass --force to build it anyway.`);
}

const badImages = relativeReadmeImages();
if (badImages.length > 0) {
  fail(`README.md has images that are not absolute https URLs; they would be broken on open-vsx.org:\n  ${badImages.join('\n  ')}`);
}

mkdirSync(outDir, { recursive: true });
run('typecheck', 'npm run typecheck');
// vsce runs `vscode:prepublish` (production build) itself; ovsx publishes this same file.
run('package', `npx --yes @vscode/vsce package --no-dependencies --skip-license -o "${outFile}"`);

const entries = zipEntries(outFile);
const lower = entries.map((f) => f.toLowerCase());
const missing = REQUIRED.filter((f) => !lower.includes(f));
if (!lower.some((f) => f === 'extension/license' || f.startsWith('extension/license.'))) missing.push('extension/LICENSE');
const walkthrough = lower.filter((f) => f.startsWith('extension/media/walkthrough/')).length;
if (walkthrough === 0) missing.push('extension/media/walkthrough/*');
if (missing.length > 0) fail('\nThese files are missing from the package:\n  ' + missing.join('\n  '));

const kb = Math.round(statSync(outFile).size / 1024);
console.log(`\n${shown} (${kb} KB, ${entries.length} files, ${walkthrough} walkthrough assets)`);
console.log(`Open VSX: ${publisher}.${name} ${version}${state.latestVersion ? ` (published there now: ${state.latestVersion})` : ' (not published there yet)'}`);

if (publish) {
  if (!process.env.OVSX_PAT) fail('\nOVSX_PAT is not set; create an access token at https://open-vsx.org/user-settings/tokens first.');
  if (!state.namespaceExists) run('create-namespace', `npx --yes ovsx create-namespace ${publisher} -p %OVSX_PAT%`.replace('%OVSX_PAT%', process.env.OVSX_PAT));
  run('publish', `npx --yes ovsx publish "${outFile}" -p ${process.env.OVSX_PAT}`);
  console.log(`\nhttps://open-vsx.org/extension/${publisher}/${name}`);
} else {
  console.log('\nTo publish (needs a signed Eclipse Publisher Agreement and an access token from https://open-vsx.org/user-settings/tokens):');
  if (!state.namespaceExists) console.log(`  npx ovsx create-namespace ${publisher} -p <token>`);
  console.log(`  npx ovsx publish "${shown}" -p <token>`);
  console.log('Or run this script again with --publish and OVSX_PAT set.');
}
