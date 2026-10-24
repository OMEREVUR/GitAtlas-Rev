// Webview önizlemesi: bir repodan gerçek modeli üretir (dev/out/preview-model.js), dev/preview.html'i
// headless Chrome ile açıp koyu/açık/vurgulu/dar ekran görüntülerini dev/screenshots/ altına alır.
// Kullanım: npm run preview -- <repo-yolu> [--name ad] [--lang en|tr] [--no-shots] [--only <ad parçası>]
import { parseLang, setLang } from '../src/i18n';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_IGNORE } from '../src/config';
import { computeFileStats } from '../src/model/aggregate';
import { loadGraph } from '../src/model/graphService';
import { computeContrib } from '../src/model/contrib';
import { branchCommits } from '../src/model/graphSelect';
import { buildTimeline } from '../src/model/timeline';
import { getStatus, listStashes } from '../src/git/status';
import type { GitHubData, PullRequest, TimeRange } from '../src/types';
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
  // --lang en: model metinleri (dönüm noktaları vb.) ve webview İngilizce.
  const langIdx = args.indexOf('--lang');
  const lang = parseLang(langIdx >= 0 ? args[langIdx + 1] : undefined) ?? 'tr';
  setLang(lang);
  if (!existsSync('dist/webview.js')) throw new Error('Önce npm run build çalıştır.');

  let sampleBranch: string | undefined;
  let hotPath: string | undefined;
  const storageDir = mkdtempSync(join(tmpdir(), 'gitatlas-revrev-preview-'));
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
    // v4: zaman makinesi ve katkı (gerçek veri).
    const timeline = buildTimeline(snap, computeFileStats(snap, 'all', ignore, now), graphAll.refs);
    const contribs: Record<string, unknown> = {};
    for (const r of ['7d', '30d', 'all'] as TimeRange[]) {
      contribs[r] = computeContrib(snap.commits, computeFileStats(snap, r, ignore, now), r, now);
    }
    // v3: GitHub'a gerçekten bağlanmadan, branch'lerden türetilmiş SAHTE PR'lar (önizleme içindir).
    const hot = computeFileStats(snap, 'all', ignore, now).sort((a, b) => b.changes - a.changes)[0]?.path;
    const cis: PullRequest['ci'][] = ['success', 'failure', 'pending'];
    const prs: PullRequest[] = graphAll.refs
      .filter((r) => r.kind === 'local' && !r.isHead)
      .slice(0, 3)
      .map((r, i) => {
        const files = new Set(branchCommits(r, graphAll.refs, graphAll.commits, graphAll.head).flatMap((c) => c.files.map((f) => f.path)));
        if (hot && i < 2) files.add(hot);
        hotPath = hot;
        return {
          number: 41 + i, title: r.subject, url: `https://github.com/example/repo/pull/${41 + i}`, author: r.author,
          headRef: r.name, baseRef: 'main', isDraft: i === 2, updatedAt: r.date, files: [...files], ci: cis[i % 3] ?? 'none',
        };
      });
    const github: GitHubData = {
      status: { state: 'connected', repo: 'example/repo', fetchedAt: now - 60_000, intervalMin: 2, baseIntervalMin: 2, rateLimit: { remaining: 4870, limit: 5000, resetAt: now + 3600_000 } },
      pullRequests: prs,
      branchCi: [{ branch: 'main', ci: 'success' }],
    };
    // v5: gerçek çalışma ağacı durumu ve stash listesi.
    const status = await getStatus(snap.root);
    const stashes = await listStashes(snap.root);
    const model = {
      status,
      stashes,
      timeline,
      contribs,
      github,
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
    { file: `${name}-time-dark.png`, query: 'theme=dark&view=time', size: '1200,820' },
    { file: `${name}-time-light-early.png`, query: 'theme=light&view=time&timeback=60', size: '1200,820' },
    { file: `${name}-contrib-dark.png`, query: 'theme=dark&view=contrib&range=all', size: '1200,900' },
    { file: `${name}-contrib-light.png`, query: 'theme=light&view=contrib&range=all', size: '1200,900' },
    { file: `${name}-gh-map-dark.png`, query: 'theme=dark&gh=connected', size: '1100,820' },
    { file: `${name}-gh-card-light.png`, query: `theme=light&gh=connected&select=${encodeURIComponent(hotPath ?? '')}`, size: '1100,1000' },
    { file: `${name}-gh-stale-dark.png`, query: 'theme=dark&gh=stale', size: '1100,820' },
    { file: `${name}-gh-off-light.png`, query: 'theme=light&gh=off', size: '1100,820' },
    { file: `${name}-gh-graph-dark.png`, query: 'theme=dark&view=graph&gh=connected', size: '1200,820' },
    { file: `${name}-changes-dark.png`, query: 'theme=dark&view=changes&gh=off', size: '1200,820' },
    { file: `${name}-changes-light.png`, query: 'theme=light&view=changes&gh=off&tree=1', size: '1200,820' },
    { file: `${name}-changes-narrow.png`, query: 'theme=dark&view=changes&gh=off&width=360', size: '600,1500' },
    { file: `${name}-changes-result.png`, query: 'theme=dark&view=changes&gh=off&opdemo=1', size: '1200,820' },
    { file: `${name}-map-dirty.png`, query: 'theme=light&gh=off', size: '1100,820' },
    { file: `${name}-changes-pr-dark.png`, query: 'theme=dark&view=changes&gh=connected', size: '1200,1100' },
    { file: `${name}-changes-pr-light.png`, query: 'theme=light&view=changes&gh=connected', size: '1200,1100' },
    // 0.3.0: çoklu repo
    { file: `${name}-repos-dark.png`, query: 'theme=dark&repos=3&gh=off', size: '1100,820' },
    { file: `${name}-repos-light.png`, query: 'theme=light&repos=3&view=changes&gh=off', size: '1200,820' },
    { file: `${name}-repos-narrow.png`, query: 'theme=dark&repos=3&gh=off&width=360', size: '600,1300' },
  ];
  if (sampleBranch) {
    const b = encodeURIComponent(`branch:${sampleBranch}`);
    shots.push(
      { file: `${name}-graph-branch.png`, query: `theme=dark&view=graph&autoselect=${b}`, size: '1200,820' },
      { file: `${name}-map-branch.png`, query: `theme=light&autoselect=${b}`, size: '1100,820' },
    );
  }
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  for (const s of shots) {
    if (only && !s.file.includes(only)) continue;
    const out = resolve('dev/screenshots', s.file);
    const r = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
      '--virtual-time-budget=4000', `--window-size=${s.size}`, `--screenshot=${out}`, `${page}?${s.query}&lang=${lang}`,
    ], { encoding: 'utf8' });
    console.log(`${existsSync(out) ? 'görüntü' : 'HATA'}: ${out}${r.status ? ` (çıkış ${r.status})` : ''}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
