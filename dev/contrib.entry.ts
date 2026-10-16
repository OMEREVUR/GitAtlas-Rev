// YALNIZCA dev önizlemesi: katkı paneli, sahte ContribData ile.
// URL: ?theme=dark|light  ?width=360  ?author=<key>  ?range=7d|30d|all  ?many=1 (6 yazar: "diğer" grubu)  ?selftest=1
import '../src/webview/base.css';
import '../src/webview/panel.css';
import '../src/webview/contributors.css';
import type { AuthorStat, ContribData, ModuleOwnership, TimeRange } from '../src/types';
import { renderContributors } from '../src/webview/contributors';

const params = new URLSearchParams(location.search);
document.body.className = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
const width = Number(params.get('width'));
if (width > 0) document.body.style.setProperty('width', `${width}px`);

const NOW = new Date(2026, 9, 17, 12, 0).getTime();
const DAY = 24 * 3600_000;

const AUTHORS: AuthorStat[] = [
  { key: 'deniz@example.com', name: 'deniz', email: 'deniz@example.com', commits: 41, added: 2140, deleted: 610, topModule: 'src/git' },
  { key: 'mert@example.com', name: 'mert', email: 'mert@example.com', commits: 33, added: 1720, deleted: 540, topModule: 'src/webview' },
  { key: 'ayse@example.com', name: 'Ayşe Yılmaz', email: 'ayse@example.com', commits: 19, added: 880, deleted: 210, topModule: 'test' },
  { key: 'can@example.com', name: 'can', email: 'can@example.com', commits: 8, added: 160, deleted: 40, topModule: '' },
];
if (params.get('many') === '1') {
  AUTHORS.push(
    { key: 'ece@example.com', name: 'ece', email: 'ece@example.com', commits: 5, added: 90, deleted: 12, topModule: 'docs' },
    { key: 'bot@example.com', name: 'dependabot', email: 'bot@example.com', commits: 4, added: 40, deleted: 40 },
  );
}
const k = (name: string): string => `${name}@example.com`;

const raw: Array<[string, Array<[string, number]>]> = [
  ['src/git', [['deniz', 820], ['mert', 140], ['ayse', 60]]],
  ['src/webview', [['mert', 900], ['deniz', 420], ['ayse', 300], ['can', 80], ['ece', 60]]],
  ['src/model', [['deniz', 380], ['ayse', 360], ['mert', 120]]],
  ['src/panel', [['mert', 260], ['can', 60]]],
  ['src/decorations', [['ayse', 96], ['deniz', 4]]],
  ['test', [['ayse', 300], ['deniz', 200], ['mert', 180], ['bot', 40]]],
  ['', [['can', 100], ['bot', 40], ['deniz', 30]]],
];
const MODULES: ModuleOwnership[] = raw.map(([module, shares]) => {
  const list = shares.filter(([a]) => AUTHORS.some((x) => x.key === k(a)));
  return {
    module,
    total: list.reduce((s, [, n]) => s + n, 0),
    shares: list.map(([a, lines]) => ({ author: k(a), lines })).sort((a, b) => b.lines - a.lines),
  };
});

// Son 4 haftanın pazartesileri (yerel 00:00).
const monday = new Date(NOW);
monday.setHours(0, 0, 0, 0);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const WEEKS = [3, 2, 1, 0].map((w) => monday.getTime() - w * 7 * DAY);

let seed = 11;
const rand = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const rhythm: Record<string, number[][]> = {};
for (const a of AUTHORS) {
  rhythm[a.key] = WEEKS.map(() => Array.from({ length: 7 }, (_, d) => (d >= 5 ? (rand() < 0.15 ? 1 : 0) : Math.floor(rand() * rand() * 6))));
}
rhythm[''] = WEEKS.map((_, w) => Array.from({ length: 7 }, (_, d) => AUTHORS.reduce((s, a) => s + (rhythm[a.key]?.[w]?.[d] ?? 0), 0)));

const DATA: ContribData = {
  range: (params.get('range') as TimeRange | null) ?? '30d',
  since: NOW - 30 * DAY,
  until: NOW,
  authors: AUTHORS,
  modules: MODULES,
  weeks: WEEKS,
  rhythm,
  experts: [
    { path: 'src/git/logParser.ts', author: k('deniz'), share: 0.91 },
    { path: 'src/webview/treemap.ts', author: k('mert'), share: 0.64 },
    { path: 'src/model/stats.ts', author: k('ayse'), share: 0.52 },
    { path: 'src/decorations/badges.ts', author: k('ayse'), share: 0.96 },
    { path: 'package.json', author: k('can'), share: 0.4 },
  ],
};

const logEl = document.getElementById('log') as HTMLElement;
const log = (text: string): void => {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
};

const host = document.getElementById('contrib') as HTMLElement;
let selectedAuthor = params.get('author') ?? undefined;
function render(): void {
  renderContributors(host, {
    data: DATA,
    selectedAuthor,
    now: NOW,
    onSelectAuthor: (key) => {
      log(`onSelectAuthor ${key ?? '(Herkes)'}`);
      selectedAuthor = key;
      render();
    },
    onSelectFile: (path) => log(`onSelectFile ${path}`),
  });
}
render();

if (params.get('selftest') === '1') {
  const check = (name: string, ok: boolean): void => log(`${ok ? 'OK  ' : 'HATA'} ${name}`);
  const authors = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('.rr-ct-author')];
  authors()[2]?.click();
  check('yazar seçimi aria-pressed', authors()[2]?.getAttribute('aria-pressed') === 'true' && selectedAuthor === k('mert'));
  check('seçili yazar dışındaki segmentler soluk', host.querySelectorAll('.rr-ct-seg.is-dim').length > 0);
  check('ritim başlığı seçili yazar', (host.querySelector('.rr-ct-rhythm h3')?.textContent ?? '').endsWith('mert'));
  authors()[0]?.click();
  check('Herkes → undefined', selectedAuthor === undefined);
  host.querySelector<HTMLButtonElement>('.rr-ct-file')?.click();
  check('tek kişiye bağlı etiketi var', host.querySelectorAll('.rr-ct-risk').length >= 1);
  const cell = host.querySelector('.rr-ct-cell');
  log(`ilk hücre aria-label: ${cell?.getAttribute('aria-label') ?? '-'}`);
  log(`ilk modül aria-label: ${host.querySelector('.rr-ct-bar')?.getAttribute('aria-label') ?? '-'}`);
}
