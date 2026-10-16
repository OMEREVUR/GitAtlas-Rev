// Build: dist/extension.js (node, cjs) + dist/webview.js/.css (browser, iife) + dist/codicons.
// Flags: --watch, --production (minify), --dev (also builds dev/*.entry.ts -> dev/out/*.js)
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const production = args.has('--production');
const dev = args.has('--dev');

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'inline',
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
  },
];

if (dev && existsSync('dev')) {
  const entries = readdirSync('dev').filter((f) => f.endsWith('.entry.ts')).map((f) => `dev/${f}`);
  if (entries.length > 0) {
    configs.push({
      ...common,
      entryPoints: entries,
      outdir: 'dev/out',
      entryNames: '[name]',
      platform: 'browser',
      format: 'iife',
      target: 'es2020',
    });
  }
}

function copyCodicons() {
  const src = 'node_modules/@vscode/codicons/dist';
  mkdirSync('dist/codicons', { recursive: true });
  for (const f of ['codicon.css', 'codicon.ttf']) copyFileSync(`${src}/${f}`, `dist/codicons/${f}`);
}

copyCodicons();
if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
