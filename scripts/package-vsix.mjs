// Builds Extension-Versions/<name>-<version>.vsix (used by `make vsix`).
// The logic lives here rather than in the Makefile so it behaves the same under cmd, PowerShell and sh.
//
//   node scripts/package-vsix.mjs [--force] [--out <dir>]
//
// --force  overwrite an existing VSIX of the same version (by default it refuses: that file may already be published)
// --out    output directory (default: Extension-Versions)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const outIndex = args.indexOf('--out');
const outDir = resolve(root, outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : 'Extension-Versions');

const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outFile = join(outDir, `${name}-${version}.vsix`);
const rel = relative(root, outFile);
const shown = rel.startsWith('..') ? outFile : rel;

if (existsSync(outFile) && !force) {
  console.error(`${shown} already exists. Bump "version" in package.json, or run \`make vsix FORCE=1\` to overwrite it.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function run(label, command) {
  console.log(`\n> ${label}`);
  // A single command string: npm/npx are .cmd files on Windows and need a shell.
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n${label} failed; no VSIX was written.`);
    process.exit(result.status ?? 1);
  }
}

run('typecheck', 'npm run typecheck');
// vsce runs `vscode:prepublish` (production build) itself.
run('package', `npx --yes @vscode/vsce package --no-dependencies --skip-license -o "${outFile}"`);

const kb = Math.round(statSync(outFile).size / 1024);
console.log(`\n${shown} (${kb} KB)`);
