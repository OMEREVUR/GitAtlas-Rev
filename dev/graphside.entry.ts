// YALNIZCA dev önizlemesi: graph araç çubuğu + seçim ayrıntısı paneli, sahte veriyle.
// URL: ?theme=dark|light  ?sel=commit|merge|branch|stale|none  ?width=360  ?selftest=1  ?pr=1 (PR satırları)
import '../src/webview/base.css';
import '../src/webview/panel.css';
import type { CommitFileChange, CommitSummary, GitRef, PullRequest } from '../src/types';
import type { WebviewToExtension } from '../src/protocol';
import { renderGraphToolbar, type GraphFilters } from '../src/webview/graphToolbar';
import { renderCommitDetail, type GraphSelection } from '../src/webview/commitDetail';

const NOW = Date.UTC(2026, 9, 17, 12, 0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const params = new URLSearchParams(location.search);
document.body.className = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
const width = Number(params.get('width'));
if (width > 0) {
  document.body.style.setProperty('width', `${width}px`);
  document.body.classList.add('dev-narrow');
}

function hash(n: number): string {
  return (n * 2654435761).toString(16).padStart(8, '0').repeat(5).slice(0, 40);
}
function commit(
  n: number,
  message: string,
  author: string,
  ageHours: number,
  files: CommitFileChange[],
  parents = 1,
): CommitSummary {
  const h = hash(n);
  return {
    hash: h,
    shortHash: h.slice(0, 7),
    parents: Array.from({ length: parents }, (_, i) => hash(n + 100 + i)),
    author,
    email: `${author}@example.com`,
    date: NOW - ageHours * HOUR,
    message,
    files,
  };
}

const COMMITS: CommitSummary[] = [
  commit(1, 'feat: graph şeritlerinde merge noktaları içi boş çiziliyor', 'deniz', 0.5, [
    { path: 'src/webview/graphView.ts', added: 84, deleted: 12 },
    { path: 'src/webview/graph.css', added: 22, deleted: 3 },
    { path: 'src/model/graphLayout.ts', added: 40, deleted: 18 },
  ]),
  commit(2, "Merge branch 'feature/graph' into main", 'mert', 5, [], 2),
  commit(3, 'fix: <script>alert(1)</script> gibi mesajlar düz metin', 'ayse', 20, [
    { path: 'src/webview/commitDetail.ts', added: 6, deleted: 2 },
  ]),
  commit(4, 'refactor: ref ayrıştırıcı', 'deniz', 30, [
    { path: 'src/git/refs.ts', added: 120, deleted: 0 },
    { path: 'src/git/gitRunner.ts', added: 4, deleted: 4 },
    { path: 'test/refs.test.ts', added: 66, deleted: 0 },
  ]),
  commit(5, 'feat: branch paneli', 'mert', 52, [
    { path: 'src/webview/branchPanel.ts', added: 210, deleted: 0 },
    { path: 'src/webview/graph.css', added: 40, deleted: 6 },
    { path: 'src/model/graphLayout.ts', added: 15, deleted: 9 },
  ]),
  commit(6, 'chore: README', 'can', 80, [{ path: 'README.md', added: 12, deleted: 4 }]),
  commit(7, 'deneme: eski yaklaşım', 'can', 24 * 95, [
    { path: 'src/experiment/old.ts', added: 300, deleted: 0 },
  ]),
];

const ref = (r: Partial<GitRef> & Pick<GitRef, 'name' | 'kind' | 'hash'>): GitRef => ({
  fullName: r.kind === 'local' ? `refs/heads/${r.name}` : r.kind === 'remote' ? `refs/remotes/${r.name}` : `refs/tags/${r.name}`,
  isHead: false,
  date: NOW,
  subject: '',
  author: '',
  ...r,
});

const REFS: GitRef[] = [
  ref({ name: 'main', kind: 'local', hash: hash(1), isHead: true, upstream: 'origin/main', compareTo: 'origin/main', ahead: 2, behind: 0, date: NOW - 0.5 * HOUR, author: 'deniz' }),
  ref({ name: 'feature/graph', kind: 'local', hash: hash(5), upstream: 'origin/feature/graph', compareTo: 'origin/feature/graph', ahead: 3, behind: 1, date: NOW - 52 * HOUR, author: 'mert' }),
  ref({ name: 'old/experiment-with-a-very-long-branch-name', kind: 'local', hash: hash(7), compareTo: 'main', ahead: 1, behind: 40, date: NOW - 95 * DAY, author: 'can' }),
  ref({ name: 'origin/main', kind: 'remote', hash: hash(3), date: NOW - 20 * HOUR, author: 'ayse' }),
  ref({ name: 'origin/feature/graph', kind: 'remote', hash: hash(4), date: NOW - 30 * HOUR }),
  ref({ name: 'v1.0', kind: 'tag', hash: hash(1) }),
];
const AUTHORS = ['deniz', 'mert', 'ayse', 'can'];
const MAP_FILES = [...new Set(COMMITS.flatMap((c) => c.files.map((f) => f.path)))].concat(
  'src/extension.ts',
  'src/types.ts',
  'package.json',
  'src/webview/treemap.ts',
  'src/webview/main.ts',
);

function selectionFor(kind: string | null): GraphSelection | undefined {
  const c = (n: number): CommitSummary => COMMITS[n] as CommitSummary;
  const r = (n: number): GitRef => REFS[n] as GitRef;
  switch (kind) {
    case 'none':
      return undefined;
    case 'merge':
      return { kind: 'commit', commit: c(1), refs: [] };
    case 'branch':
      return { kind: 'branch', ref: r(1), commits: [c(3), c(4)] };
    case 'stale':
      return { kind: 'branch', ref: r(2), commits: [c(6)] };
    default:
      return { kind: 'commit', commit: c(0), refs: [r(0), r(5)] };
  }
}

function touched(sel: GraphSelection | undefined): Set<string> {
  if (!sel) return new Set();
  const commits = sel.kind === 'commit' ? [sel.commit] : sel.commits;
  return new Set(commits.flatMap((c) => c.files.map((f) => f.path)).filter((p) => MAP_FILES.includes(p)));
}

/** C'nin compact treemap'i yerine sahte mini harita: dosya başına bir kutu, dokunulanlar sıcak renkte. */
function fakeMiniMap(host: HTMLElement, hot: Set<string>): void {
  host.style.setProperty('display', 'grid');
  host.style.setProperty('grid-template-columns', 'repeat(5, minmax(0, 1fr))');
  host.style.setProperty('gap', '1px');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', `Sahte mini harita, ${hot.size} dosya vurgulu`);
  for (const p of MAP_FILES) {
    const box = document.createElement('span');
    box.style.setProperty('background', hot.has(p) ? 'var(--rr-c4)' : 'var(--rr-c1)');
    box.title = p;
    host.append(box);
  }
}

const FAKE_PRS: PullRequest[] = [
  { number: 41, title: 'Graph görünümü', url: 'https://github.com/ornek/rewiewrev/pull/41', author: 'mert', headRef: 'feature/graph', baseRef: 'main', isDraft: false, updatedAt: NOW, files: [], ci: 'success' },
  { number: 42, title: 'main üzerinde sürüm hazırlığı', url: 'https://github.com/ornek/rewiewrev/pull/42', author: 'deniz', headRef: 'main', baseRef: 'release', isDraft: true, updatedAt: NOW, files: [], ci: 'pending' },
];

// ---------- sayfa ----------
const logEl = document.getElementById('log') as HTMLElement;
function log(text: string): void {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
}
const post = (msg: WebviewToExtension): void => log(`post ${JSON.stringify(msg)}`);

const toolbarEl = document.getElementById('toolbar') as HTMLElement;
const detailEl = document.getElementById('detail') as HTMLElement;
const listEl = document.getElementById('list') as HTMLElement;

let filters: GraphFilters = { query: '', plain: false };
let selection = selectionFor(params.get('sel'));
let renders = 0;

function render(): void {
  renders++;
  renderGraphToolbar(toolbarEl, {
    refs: REFS,
    authors: AUTHORS,
    filters,
    onChange: (f) => {
      filters = f;
      log(`onChange ${JSON.stringify(f)}`);
      render();
    },
  });

  const q = filters.query.toLowerCase();
  const visible = COMMITS.filter(
    (c) =>
      (!filters.author || c.author === filters.author) &&
      (!q || c.message.toLowerCase().includes(q) || c.hash.startsWith(q) || c.files.some((f) => f.path.includes(q))),
  );
  listEl.replaceChildren(
    ...visible.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dev-row';
      b.textContent = `${c.shortHash}  ${c.message}`;
      b.addEventListener('click', () => {
        selection = { kind: 'commit', commit: c, refs: REFS.filter((r) => r.hash === c.hash) };
        render();
      });
      return b;
    }),
  );

  const hot = touched(selection);
  renderCommitDetail(detailEl, selection, post, {
    now: NOW,
    touchedCount: hot.size,
    prsForBranch: params.get('pr') === '1' ? (name) => FAKE_PRS.filter((p) => p.headRef === name) : undefined,
    totalCount: MAP_FILES.length,
    renderMiniMap: (host) => fakeMiniMap(host, hot),
    onShowInMap: () => log('onShowInMap'),
    onClear: () => {
      log('onClear');
      selection = undefined;
      render();
    },
  });
}
render();

// ?selftest=1: etkileşimleri simüle eder, sonuçları günlüğe yazar (headless --dump-dom için).
if (params.get('selftest') === '1') {
  void (async () => {
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const check = (name: string, ok: boolean): void => log(`${ok ? 'OK  ' : 'HATA'} ${name}`);
    const [branchSel, authorSel] = [...toolbarEl.querySelectorAll('select')] as HTMLSelectElement[];
    const input = toolbarEl.querySelector('input') as HTMLInputElement;

    if (branchSel && authorSel) {
      branchSel.value = 'feature/graph';
      branchSel.dispatchEvent(new Event('change'));
      check('branch seçici → filters.branch', filters.branch === 'feature/graph');
      authorSel.value = 'mert';
      authorSel.dispatchEvent(new Event('change'));
      check('yazar seçici → filters.author (branch korunur)', filters.author === 'mert' && filters.branch === 'feature/graph');
      check('optgroup Lokal/Remote, tag yok', [...branchSel.querySelectorAll('optgroup')].map((g) => g.label).join() === 'Lokal,Remote' && ![...branchSel.options].some((o) => o.value === 'v1.0'));
      authorSel.value = '';
      authorSel.dispatchEvent(new Event('change'));
    }

    input.focus();
    const before = renders;
    input.value = 'gra';
    input.dispatchEvent(new Event('input'));
    await wait(60);
    input.value = 'graph';
    input.dispatchEvent(new Event('input'));
    await wait(60);
    check('debounce: 150 ms dolmadan onChange yok', renders === before);
    await wait(200);
    check('debounce sonrası tek onChange, query=graph', renders === before + 1 && filters.query === 'graph');
    check('yeniden çizimde aynı input ve odak korunur', toolbarEl.querySelector('input') === input && document.activeElement === input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape kutuyu temizler', input.value === '' && filters.query === '');

    (toolbarEl.querySelector('.rr-p-toggle') as HTMLButtonElement).click();
    check('Sade liste aria-pressed', filters.plain && toolbarEl.querySelector('.rr-p-toggle')?.getAttribute('aria-pressed') === 'true');

    selection = selectionFor('commit');
    render();
    detailEl.querySelector<HTMLButtonElement>('.rr-p-file-row button')?.click();
    detailEl.querySelector<HTMLButtonElement>('.rr-p-actions .rr-p-btn-primary')?.click();
    const copy = detailEl.querySelector<HTMLButtonElement>('.rr-p-actions .rr-p-btn-secondary');
    copy?.click();
    await wait(50);
    log(`kopyala düğmesi: ${copy?.textContent ?? '-'}`);
    check('kullanıcı verisi textContent ile (script elemanı yok)', detailEl.querySelector('script') === null);
    detailEl.querySelector<HTMLButtonElement>('.rr-p-icon-btn')?.click();
    check('kapat → boş durum', detailEl.querySelector('.rr-p-detail-empty') !== null);
    log('selftest bitti');
  })();
}
