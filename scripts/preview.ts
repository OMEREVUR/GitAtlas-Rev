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
import { loadGraph } from '../src/model/graphService';
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

  let sampleBranch: string | undefined;
  const storageDir = mkdtempSync(join(tmpdir(), 'rewiewrev-preview-'));
  try {
    const snap = await loadSnapshot(resolve(repo), storageDir, () => undefined);
    const now = Date.now();
    const ignore = [...DEFAULT_IGNORE];
    // Graph: tüm branch'ler + her branch için ayrı (önizlemede branch filtresi çalışsın diye), en fazla 20 branch.
    const graphAll = await loadGraph(snap.root, { limit: 500 });
    const graphs: Record<string, unknown> = { '': graphAll };
    for (const ref of graphAll.refs.filter((r) => r.kind !== 'tag').slice(0, 20)) {
      graphs[ref.name] = await loadGraph(snap.root, { limit: 500, branch: ref.name });
    }
    sampleBranch = graphAll.refs.find((r) => r.kind === 'local' && !r.isHead)?.name ?? graphAll.currentBranch;
    const model = {
      graphs,
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
    console.log(`model: ${model.commits.length} commit, ${model.ranges.all.length} dosya, graph ${graphAll.commits.length} commit / ${graphAll.refs.length} ref → dev/out/preview-model.js`);
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
    { file: `${name}-graph-dark.png`, query: 'theme=dark&view=graph&autoselect=1', size: '1200,820' },
    { file: `${name}-graph-light.png`, query: 'theme=light&view=graph&autoselect=1', size: '1200,820' },
    { file: `${name}-graph-narrow.png`, query: 'theme=dark&view=graph&autoselect=1&width=360', size: '600,1500' },
  ];
  if (sampleBranch) {
    const b = encodeURIComponent(`branch:${sampleBranch}`);
    shots.push(
      { file: `${name}-graph-branch.png`, query: `theme=dark&view=graph&autoselect=${b}`, size: '1200,820' },
      { file: `${name}-map-branch.png`, query: `theme=light&autoselect=${b}`, size: '1100,820' },
    );
  }
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
