// YALNIZCA dev önizlemesi: sahte veriyle treemap + zaman filtresi.
// URL: ?theme=dark|light  ?root=src/git  ?highlight=1  ?select=<yol>
//      ?width=360 (sayfa genişliğini sınırla; headless Chrome pencereyi ~500px altına indirmiyor)
//      ?hover=<yol> (o kutuda tooltip'i göster; ekran görüntüsü için)
//      ?n=5000 (performans: sentetik n dosya; render süresi sağ üstte)
//      ?dirty=1 (commit edilmemiş değişiklik rozetleri)
//      ?pr=1 (açık PR sayıları; logParser.ts'te 3 PR)  ?stale=1 (eski GitHub verisi: gri)  ?missing=1 (zaman makinesi: henüz olmayan dosyalar)
import '../src/webview/base.css';
import { renderTreemap } from '../src/webview/treemap';
import { renderRangeFilter } from '../src/webview/rangeFilter';
import type { ChangeKind, FileStat, TimeRange } from '../src/types';
import { parseLang, setLang } from '../src/i18n';
// ?lang=en|tr (varsayılan tr); ilk render'dan önce.
setLang(parseLang(new URLSearchParams(location.search).get('lang')) ?? 'tr');

const DAY = 86_400_000;
const NOW = Date.now();
const AUTHORS = ['Deniz Yılmaz', 'Mert Kaya', 'Ayşe Demir', 'Can Öztürk', 'Elif Şahin'];

// [yol, satır, churn(tümü)]
const RAW: [string, number, number][] = [
  ['src/extension.ts', 142, 18], ['src/types.ts', 96, 9], ['src/protocol.ts', 54, 6], ['src/config.ts', 71, 4],
  ['src/git/logParser.ts', 356, 38], ['src/git/gitRunner.ts', 204, 6], ['src/git/blame.ts', 142, 9],
  ['src/git/refs.ts', 118, 5], ['src/git/numstat.ts', 88, 2], ['src/git/index.ts', 24, 1],
  ['src/git/lineCount.ts', 130, 7], ['src/git/rename.ts', 66, 0],
  ['src/model/fileStats.ts', 288, 24], ['src/model/glob.ts', 160, 11], ['src/model/cache.ts', 212, 15],
  ['src/model/snapshot.ts', 175, 13], ['src/model/service.ts', 240, 20], ['src/model/index.ts', 12, 0],
  ['src/panel/provider.ts', 310, 27], ['src/panel/html.ts', 98, 8], ['src/panel/messages.ts', 150, 12],
  ['src/panel/diffProvider.ts', 120, 5], ['src/panel/statusBar.ts', 84, 3],
  ['src/decorations/badges.ts', 140, 10], ['src/decorations/index.ts', 8, 0],
  ['src/webview/main.ts', 260, 30], ['src/webview/treemap.ts', 520, 33], ['src/webview/rangeFilter.ts', 40, 2],
  ['src/webview/fileCard.ts', 230, 16], ['src/webview/commitFeed.ts', 190, 14], ['src/webview/states.ts', 170, 7],
  ['src/webview/heat.ts', 34, 3], ['src/webview/format.ts', 48, 4], ['src/webview/base.css', 60, 5],
  ['src/webview/treemap.css', 200, 9], ['src/webview/panel.css', 180, 8],
  ['src/webview/icons/codicons.ts', 40, 1], ['src/webview/icons/map.ts', 22, 0],
  ['src/webview/util/dom.ts', 70, 2], ['src/webview/util/debounce.ts', 18, 0], ['src/webview/util/a11y.ts', 44, 1],
  ['src/github/v3/client.ts', 12, 0], ['src/github/v3/pulls.ts', 9, 0], ['src/github/v3/checks.ts', 6, 0],
  ['test/logParser.test.ts', 240, 12], ['test/fileStats.test.ts', 190, 9], ['test/glob.test.ts', 120, 6],
  ['test/cache.test.ts', 140, 5], ['test/heat.test.ts', 60, 2], ['test/format.test.ts', 54, 1],
  ['test/fixtures/simple/README.md', 10, 0], ['test/fixtures/simple/a.ts', 20, 0], ['test/fixtures/rename/b.ts', 14, 0],
  ['scripts/make-fixture.sh', 90, 4], ['scripts/try-fixture.ts', 70, 3], ['scripts/preview.ts', 110, 2],
  ['docs/architecture.md', 210, 6], ['docs/decisions/0001-esbuild.md', 40, 1], ['docs/decisions/0002-svg.md', 38, 1],
  ['docs/decisions/0003-cache.md', 52, 2], ['docs/images/README.md', 4, 0],
  ['media/icon.svg', 12, 1], ['README.md', 180, 14], ['CHANGELOG.md', 90, 11], ['package.json', 110, 22],
  ['tsconfig.json', 28, 3], ['esbuild.mjs', 72, 6], ['vitest.config.ts', 10, 1], ['.vscodeignore', 14, 2],
  ['dev/themes.css', 50, 2], ['dev/treemap.entry.ts', 120, 3], ['dev/treemap.html', 30, 1],
  ['dev/panel.entry.ts', 110, 3], ['dev/panel.html', 28, 1],
  ['src/git/parsers/numstatLine.ts', 74, 8], ['src/git/parsers/header.ts', 58, 5], ['src/git/parsers/quote.ts', 36, 0],
  ['src/model/aggregate/byFolder.ts', 96, 4], ['src/model/aggregate/byAuthor.ts', 82, 0],
  ['LICENSE', 21, 0], ['src/webview/empty.ts', 0, 0],
];

function rand(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

function makeSynthetic(n: number, range: TimeRange): FileStat[] {
  const r = rand(n + range.length);
  return Array.from({ length: n }, (_, i) => {
    const changes = r() < 0.3 ? 0 : Math.floor(r() * r() * 40);
    return {
      path: `pkg${i % 7}/mod${Math.floor(i / 7) % 13}/sub${Math.floor(i / 91) % 9}/file${i}.ts`,
      lines: Math.floor(5 + r() * r() * 900),
      changes,
      added: changes * 10,
      deleted: changes * 4,
      lastModified: NOW - Math.round(r() * 300 * DAY),
      authors: changes > 0 ? [AUTHORS[i % AUTHORS.length]] : [],
    };
  });
}

function makeFiles(range: TimeRange): FileStat[] {
  const synthetic = Number(params.get('n'));
  if (synthetic > 0) return makeSynthetic(synthetic, range);
  const factor = range === 'all' ? 1 : range === '30d' ? 0.4 : 0.12;
  const r = rand(range === 'all' ? 7 : range === '30d' ? 11 : 13);
  return RAW.map(([path, lines, churn]) => {
    const changes = Math.round(churn * factor * (0.6 + r() * 0.8));
    const authorCount = changes === 0 ? 0 : 1 + Math.floor(r() * Math.min(4, changes));
    const start = Math.floor(r() * AUTHORS.length);
    const authors = Array.from({ length: authorCount }, (_, i) => AUTHORS[(start + i) % AUTHORS.length]);
    return {
      path,
      lines,
      changes,
      added: changes * Math.round(4 + r() * 30),
      deleted: changes * Math.round(r() * 15),
      lastModified: churn === 0 ? NOW - 400 * DAY : NOW - Math.round(r() * 40 * DAY),
      authors,
    };
  });
}

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
document.body.classList.remove('vscode-dark', 'vscode-light');
document.body.classList.add(theme);

// VS Code --vscode-* değişkenlerini <html> üzerine koyar; dev/themes.css ise body'ye koyuyor.
// base.css'teki :root --rr-* tokenları çözülebilsin diye değişkenleri html'e kopyala.
function hoistThemeVars(): void {
  const cs = getComputedStyle(document.body);
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(theme)) continue;
      for (const prop of Array.from(rule.style)) {
        if (prop.startsWith('--vscode-')) document.documentElement.style.setProperty(prop, cs.getPropertyValue(prop));
      }
    }
  }
}
hoistThemeVars();

const state = {
  range: '30d' as TimeRange,
  root: params.get('root') ?? '',
  selected: params.get('select') ?? undefined,
  highlight: new Set<string>(
    params.get('highlight') === '1'
      ? ['src/git/logParser.ts', 'src/git/numstat.ts', 'src/model/fileStats.ts', 'test/logParser.test.ts', 'src/webview/treemap.ts', 'CHANGELOG.md']
      : [],
  ),
};

const rangeEl = document.getElementById('range');
const mapEl = document.getElementById('map');
const logEl = document.getElementById('log');
if (!rangeEl || !mapEl || !logEl) throw new Error('dev/treemap.html: eksik eleman');

function log(msg: string): void {
  logEl!.textContent = msg;
}

function render(): void {
  renderRangeFilter(rangeEl!, state.range, (r) => {
    state.range = r;
    log(`onChange(${r})`);
    render();
  });
  const files = makeFiles(state.range);
  const t0 = performance.now();
  renderTreemap(mapEl!, files, {
    root: state.root,
    repoName: 'gitatlas-revrev',
    highlight: state.highlight,
    prCounts: params.get('pr') === '1' ? new Map([['src/git/logParser.ts', 3], ['src/webview/treemap.ts', 2], ['src/model/fileStats.ts', 1], ['src/panel/provider.ts', 1], ['README.md', 2], ['src/git/numstat.ts', 1]]) : undefined,
    prStale: params.get('stale') === '1',
    dirty: params.get('dirty') === '1' ? new Map<string, ChangeKind | 'conflicted'>([['src/git/logParser.ts', 'modified'], ['src/webview/treemap.ts', 'modified'], ['src/webview/main.ts', 'conflicted'], ['src/model/cache.ts', 'added'], ['src/panel/provider.ts', 'renamed'], ['README.md', 'deleted'], ['src/git/numstat.ts', 'modified']]) : undefined,
    missing: params.get('missing') === '1' ? new Set(['src/webview/treemap.ts', 'src/webview/rangeFilter.ts', 'src/webview/treemap.css', 'src/model/cache.ts', 'test/cache.test.ts', 'dev/treemap.entry.ts', 'dev/treemap.html', 'src/github/v3/client.ts']) : undefined,
    selected: state.selected,
    onSelect: (p) => {
      state.selected = p;
      log(`onSelect(${p})`);
      render();
    },
    onOpen: (p) => log(`onOpen(${p})`),
    onNavigate: (f) => {
      state.root = f;
      log(`onNavigate(${JSON.stringify(f)})`);
      render();
    },
  });
  if (files.length > 500) log(`${files.length} dosya · render ${Math.round(performance.now() - t0)} ms · ${mapEl!.querySelectorAll('.rr-tm-node').length} kutu`);
}

const pageWidth = Number(params.get('width'));
if (pageWidth > 0) {
  const page = document.querySelector<HTMLElement>('.dev-page');
  page?.style.setProperty('width', `${pageWidth}px`);
  page?.style.setProperty('outline', '1px dashed var(--vscode-panel-border)');
}

const hoverPath = params.get('hover');
function simulateHover(): void {
  if (!hoverPath) return;
  const node = mapEl!.querySelector(`[data-path="${CSS.escape(hoverPath)}"]`);
  if (!node) return;
  const r = node.getBoundingClientRect();
  node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
}

let lastSize = '';
new ResizeObserver(() => {
  const size = `${mapEl.clientWidth}x${mapEl.clientHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  render();
  simulateHover();
}).observe(mapEl);
render();
simulateHover();
