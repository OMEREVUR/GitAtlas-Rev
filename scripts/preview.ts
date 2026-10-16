// Webview önizlemesi: bir repodan gerçek modeli üretir (dev/out/preview-model.js), dev/preview.html'i
// headless Chrome ile açıp koyu/açık/vurgulu/dar ekran görüntülerini dev/screenshots/ altına alır.
// Kullanım: npm run preview -- <repo-yolu> [--name ad] [--no-shots]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_IGNORE } from '../src/config';
import { computeFileStats } from '../src/model/aggregate';
import { loadSnapshot } from '../src/model/repoService';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repo = args.find((a) => !a.startsWith('--'));
  if (!repo) throw new Error('Repo yolu ver: npm run preview -- <repo-yolu>');
  const nameIdx = args.indexOf('--name');
  const name = nameIdx >= 0 ? args[nameIdx + 1] ?? 'preview' : basename(resolve(repo));
  if (!existsSync('dist/webview.js')) throw new Error('Önce npm run build çalıştır.');

  const storageDir = mkdtempSync(join(tmpdir(), 'rewiewrev-preview-'));
  try {
    const snap = await loadSnapshot(resolve(repo), storageDir, () => undefined);
    const now = Date.now();
    const ignore = [...DEFAULT_IGNORE];
    const model = {
      repoName: basename(snap.root),
      commits: snap.commits.slice(0, 1000),
      ranges: {
        '7d': computeFileStats(snap, '7d', ignore, now),
        '30d': computeFileStats(snap, '30d', ignore, now),
        all: computeFileStats(snap, 'all', ignore, now),
      },
    };
    mkdirSync('dev/out', { recursive: true });
    writeFileSync('dev/out/preview-model.js', `window.__RR_PREVIEW__ = ${JSON.stringify(model)};\n`);
    console.log(`model: ${model.commits.length} commit, ${model.ranges.all.length} dosya → dev/out/preview-model.js`);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
  }

  if (args.includes('--no-shots')) return;
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('Chrome/Edge bulunamadı; dev/preview.html dosyasını tarayıcıda elle aç.');
  mkdirSync('dev/screenshots', { recursive: true });
  const page = pathToFileURL(resolve('dev/preview.html')).href;
  const shots: { file: string; query: string; size: string }[] = [
    { file: `${name}-dark.png`, query: 'theme=dark', size: '1100,820' },
    { file: `${name}-light.png`, query: 'theme=light', size: '1100,820' },
    { file: `${name}-dark-highlight.png`, query: 'theme=dark&autoselect=1', size: '1100,820' },
    { file: `${name}-light-highlight.png`, query: 'theme=light&autoselect=1', size: '1100,820' },
    { file: `${name}-dark-narrow.png`, query: 'theme=dark&autoselect=1&width=360', size: '600,1300' },
  ];
  for (const s of shots) {
    const out = resolve('dev/screenshots', s.file);
    const r = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
      '--virtual-time-budget=4000', `--window-size=${s.size}`, `--screenshot=${out}`, `${page}?${s.query}`,
    ], { encoding: 'utf8' });
    console.log(`${existsSync(out) ? 'görüntü' : 'HATA'}: ${out}${r.status ? ` (çıkış ${r.status})` : ''}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
