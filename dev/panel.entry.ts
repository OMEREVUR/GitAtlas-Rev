// YALNIZCA dev önizlemesi: dosya kartı, commit akışı ve durum ekranları sahte veriyle.
// URL: ?theme=dark|light  ?file=<yol> ?state=loading|noRepo|noCommits|noGit|noWorkspace|unknown  ?empty=1  ?pr=1|2  ?stale=1
import '../src/webview/base.css';
import '../src/webview/panel.css';
import type { CommitFileChange, CommitSummary, FileStat, PullRequest, TimeRange } from '../src/types';
import type { ErrorCode, WebviewToExtension } from '../src/protocol';
import { heatLevels } from '../src/webview/heat';
import { renderFileCard } from '../src/webview/fileCard';
import { renderCommitFeed } from '../src/webview/commitFeed';
import { renderState, type PanelState } from '../src/webview/states';
import { parseLang, setLang } from '../src/i18n';
// ?lang=en|tr (varsayılan tr); ilk render'dan önce.
setLang(parseLang(new URLSearchParams(location.search).get('lang')) ?? 'tr');

const NOW = Date.UTC(2026, 9, 16, 12, 0);
const HOUR = 3600_000;
const AUTHORS = ['deniz', 'mert', 'ayse', 'can'];
const PATHS = [
  'src/extension.ts',
  'src/types.ts',
  'src/protocol.ts',
  'src/git/gitRunner.ts',
  'src/git/lineCounter.ts',
  'src/model/stats.ts',
  'src/model/cache.ts',
  'src/webview/main.ts',
  'src/webview/treemap.ts',
  'src/webview/fileCard.ts',
  'README.md',
  'package.json',
];
const MESSAGES = [
  'feat: treemap klasöre inme',
  'fix: boş repoda çökme',
  'chore: bağımlılıkları güncelle',
  'feat: dosya kartına yazar listesi',
  'refactor: cache anahtarını sadeleştir',
  'test: logParser için rename vakaları',
  'docs: README ekran görüntüleri',
  'fix: Windows yol ayracı (\\) normalizasyonu ve çok uzun bir commit mesajının taşmadan kesildiğini gösteren örnek',
  'feat: <b>kalın değil</b> — mesajlar textContent ile yazılır',
];

// Basit, tekrarlanabilir rastgele sayı.
let seed = 7;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

/** Yeniden adlandırma zinciri (eskiden yeniye): src/parse.ts → src/git/parser.ts → src/git/logParser.ts */
const LOG_PARSER = 'src/git/logParser.ts';
const RENAME_TOUCH: Record<number, CommitFileChange> = {
  3: { path: LOG_PARSER, added: 14, deleted: 3 },
  15: { path: LOG_PARSER, added: 40, deleted: 12 },
  20: { path: LOG_PARSER, oldPath: 'src/git/parser.ts', added: 2, deleted: 2 },
  25: { path: 'src/git/parser.ts', added: 9, deleted: 1 },
  33: { path: 'src/git/parser.ts', oldPath: 'src/parse.ts', added: 0, deleted: 0 },
  41: { path: 'src/parse.ts', added: 120, deleted: 0 },
};

function makeCommits(): CommitSummary[] {
  const commits: CommitSummary[] = [];
  let t = NOW - 25 * 60_000;
  for (let i = 0; i < 62; i++) {
    const hash = Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('');
    const files: CommitFileChange[] = [];
    const n = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const path = pick(PATHS);
      if (!files.some((f) => f.path === path)) {
        files.push({ path, added: Math.floor(rand() * 60), deleted: Math.floor(rand() * 25) });
      }
    }
    const special = RENAME_TOUCH[i];
    if (special) files.push(special);
    const merge = i === 10;
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: merge ? ['a'.repeat(40), 'b'.repeat(40)] : ['c'.repeat(40)],
      author: AUTHORS[i % 7 === 0 ? 3 : Math.floor(rand() * 3)] as string,
      email: 'dev@example.com',
      date: t,
      message: merge ? "Merge branch 'feature/cache'" : pick(MESSAGES),
      files,
    });
    t -= (2 + rand() * 30) * HOUR;
  }
  return commits;
}

const RANGE_MS: Record<TimeRange, number> = { '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR, all: Infinity };

function makeStats(commits: CommitSummary[], range: TimeRange): FileStat[] {
  const all = [...PATHS, LOG_PARSER];
  return all.map((path) => {
    const touching = commits.filter((c) => c.files.some((f) => f.path === path));
    const inRange = touching.filter((c) => NOW - c.date <= RANGE_MS[range]);
    const counts = new Map<string, number>();
    let added = 0;
    let deleted = 0;
    for (const c of inRange) {
      counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
      const f = c.files.find((x) => x.path === path);
      added += f?.added ?? 0;
      deleted += f?.deleted ?? 0;
    }
    return {
      path,
      lines: 80 + ((path.length * 97) % 900),
      changes: inRange.length,
      added,
      deleted,
      lastModified: touching[0]?.date ?? 0,
      authors: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a),
    };
  });
}

// ---------- sayfa ----------
const params = new URLSearchParams(location.search);
document.body.className = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';


const logEl = document.getElementById('log') as HTMLElement;
function log(text: string): void {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
}
function post(msg: WebviewToExtension): void {
  log(`post ${JSON.stringify(msg)}`);
}

const prCount = Number(params.get('pr') ?? 0);
const FAKE_PRS: PullRequest[] = [
  { number: 41, title: 'Graph: merge noktaları ve uzun bir başlığın kart içinde kesilmesi', url: 'https://github.com/ornek/gitatlas-revrev/pull/41', author: 'mert', headRef: 'feature/graph', baseRef: 'main', isDraft: false, updatedAt: NOW - 3 * HOUR, files: [], ci: 'success' },
  { number: 44, title: 'logParser: rename takibi', url: 'https://github.com/ornek/gitatlas-revrev/pull/44', author: 'ayse', headRef: 'fix/rename', baseRef: 'main', isDraft: true, updatedAt: NOW - 20 * HOUR, files: [], ci: 'failure' },
  { number: 47, title: 'Cache sürümü', url: 'https://github.com/ornek/gitatlas-revrev/pull/47', author: 'can', headRef: 'cache-v2', baseRef: 'main', isDraft: false, updatedAt: NOW - 30 * HOUR, files: [], ci: 'pending' },
];

const stateParam = params.get('state');
const app = document.getElementById('app') as HTMLElement;

if (stateParam) {
  const stateEl = document.createElement('div');
  stateEl.className = 'dev-state';
  const logWrap = document.createElement('div');
  logWrap.className = 'dev-state-log';
  logWrap.append(logEl);
  app.style.setProperty('flex-direction', 'column');
  app.replaceChildren(stateEl, logWrap);
  if (stateParam === 'loading') {
    let p = 0.42;
    renderState(stateEl, { kind: 'loading', progress: p }, post);
    // Yerinde güncellemeyi göstermek için ilerlemeyi yavaşça artır.
    setInterval(() => {
      p = p >= 1 ? 0 : p + 0.05;
      renderState(stateEl, { kind: 'loading', progress: p }, post);
    }, 800);
  } else {
    const state: PanelState = {
      kind: 'error',
      code: stateParam as ErrorCode,
      message: 'git log beklenmeyen bir çıktı verdi: fatal: bad object HEAD',
    };
    renderState(stateEl, state, post);
  }
} else {
  const commits = makeCommits();
  let range: TimeRange = '30d';
  let stats = makeStats(commits, range);
  let selectedPath: string | undefined = params.get('empty') === '1' ? undefined : (params.get('file') ?? LOG_PARSER);
  let selectedHash: string | undefined = commits[2]?.hash;

  const feedEl = document.getElementById('feed') as HTMLElement;
  const cardEl = document.getElementById('card') as HTMLElement;
  const picker = document.getElementById('picker') as HTMLSelectElement;

  for (const s of stats) picker.append(new Option(s.path, s.path));
  for (const r of ['7d', '30d', 'all'] as const) {
    const btn = document.getElementById(`range-${r}`) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      range = r;
      stats = makeStats(commits, range);
      render();
    });
  }
  picker.addEventListener('change', () => {
    selectedPath = picker.value || undefined;
    render();
  });

  function render(): void {
    const heat = heatLevels(stats);
    const file = stats.find((s) => s.path === selectedPath);
    picker.value = selectedPath ?? '';
    for (const r of ['7d', '30d', 'all'] as const) {
      document.getElementById(`range-${r}`)?.setAttribute('aria-pressed', String(r === range));
    }
    renderFileCard(cardEl, file, commits, post, {
      prs: file ? FAKE_PRS.slice(0, prCount).map((pr) => ({ ...pr, files: [...pr.files, file.path] })) : undefined,
      prStale: params.get('stale') === '1',
      range,
      heat: (file && heat.get(file.path)) ?? 0,
      now: NOW,
      onClose: () => {
        selectedPath = undefined;
        render();
      },
    });
    renderCommitFeed(feedEl, commits, {
      selectedHash,
      now: NOW,
      onSelectCommit: (hash) => {
        selectedHash = hash;
        log(`onSelectCommit ${hash ?? '(seçim kaldırıldı)'}`);
        render();
      },
    });
  }
  render();

  // ?selftest=1: tıklamaları simüle eder, sonucu günlüğe yazar (headless doğrulama için).
  if (params.get('selftest') === '1') {
    const rows = () => [...feedEl.querySelectorAll<HTMLButtonElement>('.rr-p-feed-row')];
    rows()[5]?.click();
    log(`seçim sonrası aria-pressed: ${rows().findIndex((b) => b.getAttribute('aria-pressed') === 'true')}`);
    rows()[5]?.click();
    log(`ikinci tık sonrası seçili: ${rows().filter((b) => b.getAttribute('aria-pressed') === 'true').length}`);
    cardEl.querySelectorAll<HTMLButtonElement>('.rr-p-recent-row button').forEach((b) => b.click());
    cardEl.querySelector<HTMLButtonElement>('.rr-p-btn-primary')?.click();
    cardEl.querySelector<HTMLButtonElement>('.rr-p-icon-btn')?.click();
    log(`kapat sonrası boş durum: ${cardEl.querySelector('.rr-p-card-empty') !== null}`);
  }
}
