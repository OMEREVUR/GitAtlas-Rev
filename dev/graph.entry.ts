// YALNIZCA dev önizlemesi: sahte veriyle commit graph (+ compact mini harita).
// URL: ?pr=1 (sahte PR + CI)  ?theme=dark|light  ?plain=1  ?select=<satır no>  ?branch=1  ?filter=1  ?width=360  ?compact=1
//      ?n=2000 (commit sayısı; ≥1000'de süreler sağ üstte)  ?scroll=<satır no> (ekran görüntüsü için)
import '../src/webview/base.css';
import { renderGraph } from '../src/webview/graphView';
import { renderTreemap } from '../src/webview/treemap';
import { layoutGraph } from '../src/model/graphLayout';
import type { CiState, CommitSummary, FileStat, GitRef, GraphData } from '../src/types';
import { parseLang, setLang } from '../src/i18n';

const params = new URLSearchParams(location.search);
// ?lang=en|tr (varsayılan tr); ilk render'dan önce.
const lang = parseLang(params.get('lang')) ?? 'tr';
setLang(lang);
const theme = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
document.body.classList.remove('vscode-dark', 'vscode-light');
document.body.classList.add(theme);

const pageWidth = Number(params.get('width'));
if (pageWidth > 0) document.body.style.setProperty('width', `${pageWidth}px`);

const HOUR = 3_600_000;
const NOW = Date.now();
const AUTHORS = ['Deniz Yılmaz', 'Mert Kaya', 'Ayşe Demir', 'Can Öztürk', 'Elif Şahin'];
const FILES = [
  'src/extension.ts', 'src/types.ts', 'src/config.ts', 'src/git/logParser.ts', 'src/git/gitRunner.ts', 'src/git/refs.ts',
  'src/git/graphLog.ts', 'src/model/graphLayout.ts', 'src/model/cache.ts', 'src/model/aggregate.ts', 'src/panel/provider.ts',
  'src/panel/html.ts', 'src/webview/main.ts', 'src/webview/treemap.ts', 'src/webview/graphView.ts', 'src/webview/fileCard.ts',
  'src/webview/commitFeed.ts', 'src/webview/base.css', 'test/logParser.test.ts', 'test/graphLayout.test.ts', 'README.md', 'package.json',
];
// Sahte commit mesajları da dile göre (İngilizce ekran görüntüsünde Türkçe kelime kalmasın).
const VERBS = lang === 'en'
  ? ['add', 'fix', 'simplify', 'speed up', 'rename', 'test', 'document']
  : ['ekle', 'düzelt', 'sadeleştir', 'hızlandır', 'yeniden adlandır', 'test yaz', 'belgele'];
const TOPICS = lang === 'en'
  ? ['treemap labels', 'cache lifetime', 'numstat parsing', 'badge color', 'graph lanes', 'branch panel', 'breadcrumb', 'status bar', 'tooltip position']
  : ['treemap etiketleri', 'cache süresi', 'numstat ayrıştırma', 'rozet rengi', 'graph şeritleri', 'branch paneli', 'yol çubuğu', 'durum çubuğu', 'tooltip konumu'];

function rand(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

interface Generated {
  commits: CommitSummary[];
  refs: GitRef[];
  head: string;
  featureTip: string;
}

/** Eskiden yeniye simülasyon; sonra ters çevrilir (yeni → eski, topo sıralı). */
function generate(total: number): Generated {
  const r = rand(42);
  const out: CommitSummary[] = [];
  let t = NOW - total * 3 * HOUR;
  let seq = 0;
  const mk = (parents: string[], message: string): string => {
    seq++;
    const hash = (seq * 2654435761 >>> 0).toString(16).padStart(8, '0') + seq.toString(16).padStart(32, '0');
    t += Math.round(HOUR * (1 + r() * 4));
    const nFiles = 1 + Math.floor(r() * 3);
    out.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents,
      author: AUTHORS[Math.floor(r() * AUTHORS.length)],
      email: 'dev@example.com',
      date: t,
      message,
      files: Array.from({ length: nFiles }, () => ({ path: FILES[Math.floor(r() * FILES.length)], added: Math.floor(r() * 40), deleted: Math.floor(r() * 10) })),
    });
    return hash;
  };
  const msg = (): string => `${TOPICS[Math.floor(r() * TOPICS.length)]}: ${VERBS[Math.floor(r() * VERBS.length)]}`;

  // Yüklenmemiş geçmiş: ilk commit'in parent'ı listede yok.
  let main = mk(['f'.repeat(40)], 'ilk iskelet: yo code');
  const branches = new Map<string, string>();
  /** Branch'in açıldığı commit; kendi commit'i olmayan branch merge edilmez. */
  const bases = new Map<string, string>();
  const names = ['feat/graph', 'fix/numstat', 'feat/badges', 'feat/treemap-zoom', 'chore/deps', 'feat/branch-panel', 'fix/cache'];
  let nameIdx = 0;
  const tags: [string, string][] = [];
  let octopusDone = false;
  let featureTip = '';

  while (out.length < total) {
    const roll = r();
    if (branches.size < 4 && roll < 0.12) {
      const name = names[nameIdx++ % names.length] + (nameIdx > names.length ? `-${nameIdx}` : '');
      branches.set(name, main);
      bases.set(name, main);
      continue;
    }
    const ready = [...branches.entries()].filter(([n, tip]) => bases.get(n) !== tip);
    if (ready.length >= 3 && !octopusDone && out.length > total * 0.5) {
      const picked = ready.slice(0, 3);
      main = mk([main, ...picked.map(([, tip]) => tip)], `Merge branches '${picked.map(([n]) => n).join("', '")}' (octopus)`);
      for (const [n] of picked) branches.delete(n);
      octopusDone = true;
      continue;
    }
    if (ready.length > 0 && roll < 0.22) {
      const [name, tip] = ready[Math.floor(r() * ready.length)];
      main = mk([main, tip], `Merge branch '${name}'`);
      branches.delete(name);
      continue;
    }
    if (branches.size > 0 && roll < 0.7) {
      const [name, tip] = [...branches.entries()][Math.floor(r() * branches.size)];
      branches.set(name, mk([tip], msg()));
      continue;
    }
    main = mk([main], msg());
    if (r() < 0.04) tags.push([`v0.${tags.length + 1}.0`, main]);
  }

  const commits = out.reverse();
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const ref = (name: string, kind: GitRef['kind'], hash: string, isHead = false): GitRef => {
    const c = byHash.get(hash);
    return {
      name,
      fullName: kind === 'local' ? `refs/heads/${name}` : kind === 'remote' ? `refs/remotes/${name}` : `refs/tags/${name}`,
      kind,
      hash,
      isHead,
      date: c?.date ?? 0,
      subject: c?.message ?? '',
      author: c?.author ?? '',
    };
  };
  // origin/main iki commit geride.
  const mainChain: string[] = [];
  for (let h: string | undefined = main; h && mainChain.length < 4; h = byHash.get(h)?.parents[0]) mainChain.push(h);
  const refs: GitRef[] = [ref('main', 'local', main, true), ref('origin/main', 'remote', mainChain[2] ?? main)];
  let first = true;
  for (const [name, tip] of branches) {
    refs.push(ref(name, 'local', tip));
    if (first) {
      refs.push(ref(`origin/${name}`, 'remote', tip));
      featureTip = tip;
      first = false;
    }
  }
  for (const [name, hash] of tags) refs.push(ref(name, 'tag', hash));
  return { commits, refs, head: main, featureTip };
}

const TOTAL = Number(params.get('n')) || 340;
const all = generate(TOTAL);
const state = {
  limit: params.get('n') ? TOTAL : Math.min(300, TOTAL),
  loadingMore: false,
  plain: params.get('plain') === '1',
  selected: undefined as string | undefined,
};
const selIdx = params.get('select');
if (selIdx !== null) state.selected = all.commits[Number(selIdx)]?.hash;

function graphData(): GraphData {
  const commits = all.commits.slice(0, state.limit);
  const t0 = performance.now();
  const layout = layoutGraph(commits);
  layoutMs = performance.now() - t0;
  return { commits, layout, refs: all.refs, head: all.head, currentBranch: 'main', limit: state.limit, hasMore: state.limit < all.commits.length };
}
let layoutMs = 0;

/** feat dalının main'de olmayan commit'leri. */
function branchHashes(): Set<string> {
  const byHash = new Map(all.commits.map((c) => [c.hash, c]));
  const onMain = new Set<string>();
  for (let h: string | undefined = all.head; h; h = byHash.get(h)?.parents[0]) onMain.add(h);
  const result = new Set<string>();
  const stack = [all.featureTip];
  while (stack.length) {
    const h = stack.pop();
    if (!h || result.has(h) || onMain.has(h) || !byHash.has(h)) continue;
    result.add(h);
    stack.push(...(byHash.get(h)?.parents ?? []));
  }
  return result;
}

const graphEl = document.getElementById('graph');
const mapEl = document.getElementById('minimap');
const mapCount = document.getElementById('minimap-count');
const logEl = document.getElementById('log');
if (!graphEl || !mapEl || !mapCount || !logEl) throw new Error('dev/graph.html: eksik eleman');

const compact = params.get('compact') === '1';
if (!compact) document.getElementById('side')?.remove();
const filterOn = params.get('filter') === '1';
const branchOn = params.get('branch') === '1';
const visible = filterOn ? new Set(all.commits.filter((c) => c.author === 'Ayşe Demir').map((c) => c.hash)) : undefined;
const bh = branchOn ? branchHashes() : undefined;

const fileStats: FileStat[] = FILES.map((path, i) => ({
  path,
  lines: 40 + ((i * 97) % 400),
  changes: (i * 7) % 13,
  added: i * 5,
  deleted: i * 2,
  lastModified: NOW - i * 5 * HOUR,
  authors: [AUTHORS[i % AUTHORS.length]],
}));

/** ?pr=1: açık branch'lere sahte PR'lar (CI geçti / başarısız / sürüyor / yok). */
const prs = params.get('pr') === '1' ? new Map<string, { number: number; ci: CiState; url: string }[]>() : undefined;
if (prs) {
  const ciCycle: CiState[] = ['success', 'failure', 'pending', 'none'];
  let n = 41;
  for (const r of all.refs) {
    if (r.kind !== 'local' || r.isHead) continue;
    prs.set(r.name, [{ number: n, ci: ciCycle[(n - 41) % ciCycle.length], url: `https://github.com/ornek/gitatlas-revrev/pull/${n}` }]);
    n++;
  }
  const first = [...prs.keys()][0];
  if (first) prs.get(first)?.push({ number: n, ci: 'success', url: '' });
}

function render(): void {
  const data = graphData();
  const t0 = performance.now();
  renderGraph(graphEl!, data, {
    plain: state.plain || filterOn,
    selectedHash: state.selected,
    branchHashes: bh,
    prsByBranch: prs,
    visible,
    now: NOW,
    loadingMore: state.loadingMore,
    onSelectCommit: (h) => {
      state.selected = h;
      logEl!.textContent = `onSelectCommit(${h ? h.slice(0, 7) : 'undefined'})`;
      render();
    },
    onLoadMore: () => {
      if (state.loadingMore) return;
      state.loadingMore = true;
      logEl!.textContent = 'onLoadMore()';
      render();
      setTimeout(() => {
        state.limit = Math.min(all.commits.length, state.limit + 100);
        state.loadingMore = false;
        render();
      }, 400);
    },
  });
  const ms = performance.now() - t0;
  if (data.commits.length >= 1000) logEl!.textContent = `${data.commits.length} commit · layout ${Math.round(layoutMs)} ms · render ${Math.round(ms)} ms`;
  if (compact) renderMini();
}

function renderMini(): void {
  const sel = all.commits.find((c) => c.hash === state.selected);
  const touched = new Set(sel ? sel.files.map((f) => f.path) : []);
  mapCount!.textContent = `${touched.size} / ${fileStats.length} dosya`;
  renderTreemap(mapEl!, fileStats, {
    compact: true,
    root: '',
    repoName: 'gitatlas-revrev',
    highlight: touched,
    onSelect: (p) => (logEl!.textContent = `mini onSelect(${p})`),
    onOpen: () => undefined,
    onNavigate: () => undefined,
  });
}

let lastSize = '';
new ResizeObserver(() => {
  const size = `${graphEl.clientWidth}x${graphEl.clientHeight}:${mapEl.clientWidth}x${mapEl.clientHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  render();
}).observe(document.body);
render();

const scrollRow = Number(params.get('scroll'));
if (scrollRow > 0) {
  const sc = graphEl.querySelector<HTMLElement>('.rr-g-scroll');
  if (sc) sc.scrollTop = scrollRow * 32;
}
