// Bir TypeScript scriptini esbuild ile bundle edip node ile çalıştırır: node scripts/run-ts.mjs <dosya.ts> [argümanlar...]
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const [entry, ...rest] = process.argv.slice(2);
if (!entry) {
  console.error('Kullanım: node scripts/run-ts.mjs <dosya.ts> [argümanlar...]');
  process.exit(2);
}
mkdirSync('dev/out', { recursive: true });
const outfile = `dev/out/${basename(entry, '.ts')}.cjs`;
await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: 'inline',
  logLevel: 'warning',
  // src/config.ts gibi modüller 'vscode' import eder; scriptlerde yalnızca boş ayar dönen bir taklit verilir.
  plugins: [
    {
      name: 'vscode-stub',
      setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'vscode-stub' }));
        build.onLoad({ filter: /.*/, namespace: 'vscode-stub' }, () => ({
          contents: 'module.exports = { workspace: { getConfiguration: () => ({ get: (_k, d) => d }) } };',
          loader: 'js',
        }));
      },
    },
  ],
});
const r = spawnSync(process.execPath, ['--enable-source-maps', outfile, ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
