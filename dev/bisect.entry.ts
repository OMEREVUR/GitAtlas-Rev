// YALNIZCA dev önizlemesi: sahte BisectState ile "Bisect" sekmesinin üç durumu.
// URL: ?lang=tr|en  ?theme=dark|light  ?width=360
//      ?state=idle|waiting|active|found (varsayılan idle)
//      ?dirty=1 (çalışma ağacı kirli uyarısı)  ?busy=1 (işlem sürüyor, düğmeler kapalı)
//      ?nofiles=1 (bulunan commit'in dosyası yok)  ?selftest=1
import '../src/webview/base.css';
import '../src/webview/panel.css';
import '../src/webview/ops.css';
import { renderBisect } from '../src/webview/bisect';
import type { BisectState, CommitSummary, GitOpRequest, GitRef } from '../src/types';
import { parseLang, setLang } from '../src/i18n';

const params = new URLSearchParams(location.search);
const lang = parseLang(params.get('lang')) ?? 'tr';
setLang(lang);
// Gerçek webview <html lang> değerini dile göre yazar; başlıkların text-transform:uppercase
// sonucu dile bağlı olduğu için (tr'de i → İ) önizleme de aynısını yapmalı.
document.documentElement.lang = lang;
const theme = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
document.body.classList.remove('vscode-dark', 'vscode-light');
document.body.classList.add(theme);
const pageWidth = Number(params.get('width'));
if (pageWidth > 0) document.body.style.setProperty('width', `${pageWidth}px`);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

interface FakeCommit {
  shortHash: string;
  message: string;
  author: string;
  daysAgo: number;
}

/** Suçlu commit: dosya listesi bunun üzerinden gösterilir. */
const CULPRIT_SHORT = '3ad7f12';

/** Sahte commit'ler: en yeni başta, 40 gün geriye. */
const FAKE: FakeCommit[] = [
  { shortHash: '9f1c4ab', message: 'fix: dar panelde kart taşmasını önle', author: 'Deniz Arslan', daysAgo: 0 },
  { shortHash: '7b22d90', message: 'feat: haritada tazelik renk modu', author: 'Ece Yıldız', daysAgo: 2 },
  { shortHash: '5c08e17', message: 'refactor: ısı ölçeğini tek yere topla', author: 'Deniz Arslan', daysAgo: 5 },
  { shortHash: CULPRIT_SHORT, message: 'perf: treemap yerleşimini önbelleğe al', author: 'Mert Koç', daysAgo: 9 },
  { shortHash: '21e9b55', message: 'feat: commit akışında arama', author: 'Ece Yıldız', daysAgo: 14 },
  { shortHash: '1d4a6c3', message: 'chore: bağımlılıkları güncelle', author: 'Mert Koç', daysAgo: 21 },
  { shortHash: '0bb37f8', message: 'feat: branch ağacında ahead/behind', author: 'Selin Demir', daysAgo: 30 },
  { shortHash: '0a1e2d4', message: 'chore: 0.2.0 yayını', author: 'Deniz Arslan', daysAgo: 40 },
];

const COMMITS: CommitSummary[] = FAKE.map((f) => ({
  hash: `${f.shortHash}${'0'.repeat(40)}`.slice(0, 40),
  shortHash: f.shortHash,
  parents: [],
  author: f.author,
  email: `${f.author.split(' ')[0].toLowerCase()}@example.com`,
  date: NOW - f.daysAgo * DAY,
  message: f.message,
  files:
    f.shortHash === CULPRIT_SHORT
      ? [
          { path: 'src/webview/treemap.ts', added: 64, deleted: 23 },
          { path: 'src/webview/heat.ts', added: 18, deleted: 4 },
          { path: 'src/model/aggregate.ts', added: 7, deleted: 7 },
          { path: 'test/treemap.test.ts', added: 41, deleted: 0 },
        ]
      : [{ path: 'src/webview/main.ts', added: 12, deleted: 3 }],
}));

const byShort = (s: string): CommitSummary => {
  const c = COMMITS.find((x) => x.shortHash === s);
  if (!c) throw new Error(`dev/bisect: bilinmeyen commit ${s}`);
  return c;
};

const TAGS: GitRef[] = ['v0.3.0', 'v0.2.1', 'v0.2.0'].map((name, i) => {
  const c = COMMITS[i * 3 + 1];
  return { name, fullName: `refs/tags/${name}`, kind: 'tag', hash: c.hash, isHead: false, date: c.date, subject: c.message, author: c.author };
});

const bad = byShort('9f1c4ab');
const good = byShort('0a1e2d4');
const culprit = byShort(CULPRIT_SHORT);

/** Sürerken: kötü ve iyi işaretli, sırada 3ad7f12 test ediliyor. */
function activeState(): BisectState {
  const candidates = COMMITS.slice(0, 7).map((c) => c.hash);
  return {
    startRef: 'main',
    bad: bad.hash,
    goods: [good.hash],
    skips: [],
    current: culprit.hash,
    candidates,
    candidateCount: candidates.length,
    steps: 3,
    marks: [
      { hash: bad.hash, mark: 'bad', subject: bad.message },
      { hash: good.hash, mark: 'good', subject: good.message },
      { hash: byShort('21e9b55').hash, mark: 'good', subject: byShort('21e9b55').message },
      { hash: byShort('1d4a6c3').hash, mark: 'skip', subject: byShort('1d4a6c3').message },
    ],
  };
}

/** `git bisect start` çalıştı ama henüz iki uç verilmedi. */
function waitingState(): BisectState {
  return { startRef: 'main', goods: [], skips: [], candidates: [], candidateCount: 0, steps: 0, marks: [] };
}

function foundState(): BisectState {
  return { ...activeState(), current: culprit.hash, firstBad: culprit.hash, steps: 0 };
}

const mode = params.get('state') ?? 'idle';
const state: BisectState | undefined =
  mode === 'active' ? activeState() : mode === 'found' ? foundState() : mode === 'waiting' ? waitingState() : undefined;

const host = document.getElementById('bisect');
const logEl = document.getElementById('log');
if (!host || !logEl) throw new Error('dev/bisect.html: eksik eleman');

const ops: GitOpRequest[] = [];
function log(line: string): void {
  const div = document.createElement('div');
  div.textContent = line;
  logEl!.prepend(div);
}

const form = { bad: 'HEAD', good: undefined as string | undefined };

function render(): void {
  renderBisect(host!, {
    state,
    commitOf: (hash) => {
      if (params.get('nofiles') === '1' && hash === culprit.hash) return { ...culprit, files: [] };
      return COMMITS.find((c) => c.hash === hash);
    },
    recent: COMMITS,
    tags: TAGS,
    headName: 'main',
    form,
    dirty: params.get('dirty') === '1',
    busy: params.get('busy') === '1',
    now: NOW,
    onForm: (f) => {
      form.bad = f.bad;
      form.good = f.good;
      log(`form ${JSON.stringify(f)}`);
      render();
    },
    onOp: (op) => {
      ops.push(op);
      log(`gitOp ${JSON.stringify(op)}`);
    },
    onShowInMap: (h) => log(`showInMap(${h.slice(0, 7)})`),
    onShowInGraph: (h) => log(`showInGraph(${h.slice(0, 7)})`),
    onOpenDiff: (p, h) => log(`openDiff(${p}, ${h.slice(0, 7)})`),
  });
}
render();

// ---- ?selftest=1: her durumun beklenen düğmeleri ----
function selftest(): void {
  const results: string[] = [];
  const check = (name: string, ok: boolean): void => {
    results.push(`${ok ? 'GEÇTİ' : 'KALDI'} · ${name}`);
  };
  const lastOp = (): GitOpRequest | undefined => ops[ops.length - 1];
  const btn = (cls: string): HTMLButtonElement | null => host!.querySelector<HTMLButtonElement>(cls);

  if (mode === 'idle') {
    check('Başlat düğmesi iyi commit seçilmeden kapalı', btn('.rr-p-btn-primary')?.disabled === true);
    const sel = host!.querySelector<HTMLSelectElement>('#rr-bs-good');
    if (sel) {
      sel.value = good.hash;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    check('İyi commit seçilince açılır', btn('.rr-p-btn-primary')?.disabled === false);
    btn('.rr-p-btn-primary')?.click();
    const op = lastOp();
    check('Başlat → bisectStart', op?.kind === 'bisectStart' && op.bad === 'HEAD' && op.good === good.hash);
    check('Komut önizlemesi görünüyor', host!.querySelector('.rr-op-cmd-line')?.textContent?.includes('bisect start') === true);
  }

  if (mode === 'active') {
    for (const m of ['good', 'bad', 'skip'] as const) {
      btn(`.rr-bs-mark-${m}`)?.click();
      const op = lastOp();
      check(`${m} düğmesi → bisectMark(${m})`, op?.kind === 'bisectMark' && op.mark === m);
    }
    check('İşaret listesinde 4 satır', host!.querySelectorAll('.rr-bs-markrow').length === 4);
    check('Durum satırında kalan adım', host!.querySelector('.rr-bs-status')?.textContent?.includes('3') === true);
  }

  if (mode === 'waiting') {
    check('Uçlar verilmeden bilgi notu', host!.querySelector('.rr-bs-notebox') !== null);
    check('İşaretleme düğmeleri yok', host!.querySelector('.rr-bs-mark') === null);
  }

  if (mode === 'found') {
    check('Suçlu commit kartı', host!.querySelector('.rr-bs-status-found') !== null);
    const files = host!.querySelectorAll('.rr-bs-filerow').length;
    check(`Dosya listesi (${files})`, params.get('nofiles') === '1' ? files === 0 : files === 4);
    host!.querySelector<HTMLButtonElement>('.rr-bs-filerow .rr-p-btn-small')?.click();
    if (params.get('nofiles') !== '1') check('Diff düğmesi çalışıyor', logEl!.textContent?.includes('openDiff') === true);
    btn('.rr-p-btn-primary')?.click();
    check('Bitir → bisectReset', lastOp()?.kind === 'bisectReset');
  }

  log('— selftest —');
  for (const r of results.reverse()) log(r);
}
if (params.get('selftest') === '1') selftest();
