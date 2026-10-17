// YALNIZCA dev önizlemesi: sahte TimelineData ile zaman makinesi.
// URL: ?theme=dark|light  ?width=360  ?at=<adım indeksi>
import '../src/webview/base.css';
import { renderTimeMachine } from '../src/webview/timeMachine';
import { timelineFrame, timelineSteps } from '../src/model/timeline';
import type { FileStat, TimelineData, TimelineEvent, TimelineMark } from '../src/types';
import { parseLang, setLang } from '../src/i18n';
import { text } from '../src/i18n/map';
// ?lang=en|tr (varsayılan tr); ilk render'dan önce.
setLang(parseLang(new URLSearchParams(location.search).get('lang')) ?? 'tr');

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
document.body.classList.remove('vscode-dark', 'vscode-light');
document.body.classList.add(theme);
const pageWidth = Number(params.get('width'));
if (pageWidth > 0) document.body.style.setProperty('width', `${pageWidth}px`);

const DAY = 86_400_000;
const NOW = Date.now();
const START = NOW - 90 * DAY;
const AUTHORS = ['Deniz Yılmaz', 'Mert Kaya', 'Ayşe Demir', 'Can Öztürk'];

// [yol, satır, doğduğu gün (0 = ilk gün), ağırlık]
const FILES: [string, number, number, number][] = [
  ['src/extension.ts', 160, 0, 3], ['src/types.ts', 120, 0, 2], ['src/config.ts', 70, 2, 1], ['package.json', 110, 0, 2], ['README.md', 180, 0, 2],
  ['src/git/logParser.ts', 356, 3, 6], ['src/git/gitRunner.ts', 204, 3, 2], ['src/git/numstat.ts', 88, 10, 2], ['src/git/refs.ts', 118, 45, 3],
  ['src/git/graphLog.ts', 140, 55, 4], ['src/model/aggregate.ts', 260, 8, 4], ['src/model/cache.ts', 212, 20, 3], ['src/model/glob.ts', 160, 12, 1],
  ['src/model/graphLayout.ts', 300, 56, 6], ['src/model/timeline.ts', 180, 80, 5], ['src/model/contrib.ts', 210, 82, 4],
  ['src/panel/provider.ts', 310, 6, 4], ['src/panel/html.ts', 98, 6, 1], ['src/panel/statusBar.ts', 84, 25, 1],
  ['src/decorations/badges.ts', 140, 28, 2], ['src/github/client.ts', 220, 62, 5], ['src/github/pulls.ts', 160, 63, 4],
  ['src/webview/main.ts', 420, 5, 6], ['src/webview/treemap.ts', 640, 9, 5], ['src/webview/graphView.ts', 420, 57, 5],
  ['src/webview/timeMachine.ts', 330, 84, 4], ['src/webview/fileCard.ts', 230, 14, 3], ['src/webview/commitFeed.ts', 190, 15, 2],
  ['src/webview/base.css', 60, 5, 1], ['src/webview/treemap.css', 260, 9, 2], ['test/logParser.test.ts', 240, 4, 3],
  ['test/graphLayout.test.ts', 200, 57, 3], ['test/timeline.test.ts', 120, 81, 2], ['scripts/make-fixture.sh', 90, 7, 1],
];
const TOPICS = ['treemap', 'cache', 'numstat', 'rozet', 'graph', 'branch paneli', 'zaman makinesi', 'github'];

function rand(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

function makeTimeline(): TimelineData {
  const r = rand(9);
  const paths = FILES.map((f) => f[0]);
  const firstSeen = FILES.map((f) => START + f[2] * DAY + 3_600_000);
  const events: TimelineEvent[] = [];
  // İlk commit + her dosyanın doğduğu commit.
  for (let i = 0; i < FILES.length; i++) {
    events.push({ date: firstSeen[i], hash: `born${i}`, message: `${baseOf(paths[i])} eklendi`, author: AUTHORS[i % AUTHORS.length], files: [i] });
  }
  // ~200 olay: hafta içi daha yoğun, son 30 gün daha yoğun.
  while (events.length < 200 + FILES.length) {
    const day = Math.floor(Math.pow(r(), 0.7) * 90);
    const date = START + day * DAY + Math.floor(r() * DAY);
    const alive = FILES.map((_f, i) => (firstSeen[i] <= date ? i : -1)).filter((i) => i >= 0);
    if (alive.length === 0) continue;
    const touched = new Set<number>();
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n * 4 && touched.size < n; k++) {
      const i = alive[Math.floor(r() * alive.length)];
      if (r() < FILES[i][3] / 6) touched.add(i);
    }
    if (touched.size === 0) continue;
    events.push({ date, hash: `e${events.length}`, message: `${TOPICS[Math.floor(r() * TOPICS.length)]}: güncelle`, author: AUTHORS[Math.floor(r() * AUTHORS.length)], files: [...touched] });
  }
  events.sort((a, b) => a.date - b.date);
  const marks: TimelineMark[] = [
    { date: events[0].date, label: text().firstCommit('ilk'), kind: 'first' },
    { date: START + 44 * DAY, label: 'v0.1.0', kind: 'tag' },
    { date: START + 61 * DAY, label: "Merge branch 'feat/graph'", kind: 'merge' },
    { date: START + 79 * DAY, label: 'v0.2.0', kind: 'tag' },
  ];
  return { start: events[0].date, end: events[events.length - 1].date, paths, firstSeen, events, marks };
}

function baseOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

const timeline = makeTimeline();
const steps = timelineSteps(timeline);
const files: FileStat[] = FILES.map(([path, lines], i) => ({
  path,
  lines,
  changes: 0,
  added: 10 * (i + 1),
  deleted: 3 * i,
  lastModified: NOW - i * DAY,
  authors: [AUTHORS[i % AUTHORS.length]],
}));

const atParam = params.get('at');
const state = {
  at: atParam !== null ? steps[Math.max(0, Math.min(steps.length - 1, Number(atParam)))] : steps[steps.length - 1],
  timer: undefined as number | undefined,
};

const host = document.getElementById('tm');
const logEl = document.getElementById('log');
if (!host || !logEl) throw new Error('dev/timemachine.html: eksik eleman');

function stop(): void {
  if (state.timer !== undefined) window.clearInterval(state.timer);
  state.timer = undefined;
}

function render(): void {
  renderTimeMachine(host!, {
    files,
    timeline,
    at: state.at,
    steps,
    frame: timelineFrame(timeline, state.at, 7),
    repoName: 'gitatlas-revrev',
    playing: state.timer !== undefined,
    onSeek: (at) => {
      stop();
      state.at = at;
      logEl!.textContent = `onSeek(${new Date(at).toLocaleDateString('tr-TR')})`;
      render();
    },
    onTogglePlay: () => {
      if (state.timer !== undefined) {
        stop();
        render();
        return;
      }
      if (state.at >= steps[steps.length - 1]) state.at = steps[0];
      state.timer = window.setInterval(() => {
        const i = steps.findIndex((s) => s > state.at);
        if (i < 0) stop();
        else state.at = steps[i];
        render();
      }, 400);
      render();
    },
    onSelectFile: (p) => (logEl!.textContent = `onSelectFile(${p})`),
  });
}

let lastSize = '';
new ResizeObserver(() => {
  const size = `${host.clientWidth}x${host.clientHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  render();
}).observe(host);
render();
