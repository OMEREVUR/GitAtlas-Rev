// Zaman makinesi: geçmiş bir tarihteki harita + kaydırıcı + "Bu tarihte" paneli. Tasarım: TimeMachine.dc.html.
import './timeMachine.css';
import type { FileStat, TimelineData, TimelineMark } from '../types';
import { HEAT_LABELS, heatLevels, heatVar } from './heat';
import { baseName, formatNumber } from './format';
import { renderTreemap } from './treemap';

export interface TimeMachineOptions {
  files: FileStat[];                 // bugünkü harita dosyaları (yerleşim sabit kalır: kutu boyutu = bugünkü satır)
  timeline: TimelineData;
  at: number;                        // seçili tarih (ms)
  steps: number[];                   // kaydırıcı adımları (B: timelineSteps)
  frame: { changes: Map<string, number>; missing: Set<string>; windowCommits: number };   // B: timelineFrame(timeline, at, 7)
  repoName: string;
  playing: boolean;
  onSeek: (at: number) => void;
  onTogglePlay: () => void;
  onSelectFile: (path: string) => void;
}

const DAY = 86_400_000;
const WINDOW_DAYS = 7;
const TICKS = 5;

/** el başına kalıcı iskelet: kaydırıcı yeniden kurulmaz, sürükleme ve odak kopmaz. */
interface Skeleton {
  map: HTMLElement;
  bars: HTMLElement;
  prev: HTMLButtonElement;
  play: HTMLButtonElement;
  next: HTMLButtonElement;
  slider: HTMLInputElement;
  dateLabel: HTMLElement;
  ticks: HTMLElement;
  aside: HTMLElement;
  /** Haritada inilen klasör (zaman makinesinin kendi durumu). */
  root: string;
  opts?: TimeMachineOptions;
}
const skeletons = new WeakMap<HTMLElement, Skeleton>();

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name: string): HTMLSpanElement {
  const i = h('span', `codicon ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function shortDate(ms: number, withYear: boolean): string {
  return new Date(ms).toLocaleDateString('tr-TR', withYear ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
}

/** at'a en yakın adımın indeksi. */
function stepIndex(steps: number[], at: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - at) < Math.abs(steps[best] - at)) best = i;
  return best;
}

/** date > x olan ilk event'in indeksi. */
function upperBound(dates: { date: number }[], x: number): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid].date <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function build(el: HTMLElement): Skeleton {
  el.replaceChildren();
  el.classList.add('rr-tm2');

  const section = h('section', 'rr-tm2-main');
  section.setAttribute('aria-label', 'Geçmişteki harita');
  const top = h('div', 'rr-tm2-top');
  top.append(h('span', 'rr-tm2-note', `Isı = o tarihten önceki ${WINDOW_DAYS} gündeki değişim`));
  const map = h('div', 'rr-tm2-map');

  const controls = h('div', 'rr-tm2-controls');
  const bars = h('div', 'rr-tm2-bars');
  bars.setAttribute('aria-hidden', 'true');
  const row = h('div', 'rr-tm2-row');
  const prev = h('button', 'rr-tm2-btn');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Önceki adım');
  prev.append(icon('codicon-chevron-left'));
  const play = h('button', 'rr-tm2-btn rr-tm2-play');
  play.type = 'button';
  const next = h('button', 'rr-tm2-btn');
  next.type = 'button';
  next.setAttribute('aria-label', 'Sonraki adım');
  next.append(icon('codicon-chevron-right'));
  const label = h('label', 'rr-visually-hidden', 'Tarih');
  const slider = h('input', 'rr-tm2-slider');
  slider.type = 'range';
  slider.min = '0';
  slider.step = '1';
  slider.id = `rr-tm2-slider-${Math.random().toString(36).slice(2, 8)}`;
  label.htmlFor = slider.id;
  const dateLabel = h('span', 'rr-tm2-date');
  dateLabel.setAttribute('aria-hidden', 'true');
  row.append(prev, play, next, label, slider, dateLabel);
  const ticks = h('div', 'rr-tm2-ticks');
  ticks.setAttribute('aria-hidden', 'true');
  controls.append(bars, row, ticks);

  section.append(top, map, controls);

  const aside = h('aside', 'rr-tm2-side');
  aside.setAttribute('aria-label', 'Bu tarihte');
  const wrap = h('div', 'rr-tm2-wrap');
  wrap.append(section, aside);
  el.append(wrap);

  const sk: Skeleton = { map, bars, prev, play, next, slider, dateLabel, ticks, aside, root: '' };

  // Olaylar bir kez bağlanır; güncel seçenekler sk.opts'tan okunur.
  const seekIndex = (i: number): void => {
    const o = sk.opts;
    if (!o || o.steps.length === 0) return;
    const idx = Math.max(0, Math.min(o.steps.length - 1, i));
    o.onSeek(o.steps[idx]);
  };
  prev.onclick = () => sk.opts && seekIndex(stepIndex(sk.opts.steps, sk.opts.at) - 1);
  next.onclick = () => sk.opts && seekIndex(stepIndex(sk.opts.steps, sk.opts.at) + 1);
  play.onclick = () => sk.opts?.onTogglePlay();
  slider.oninput = () => seekIndex(Number(slider.value));
  bars.onclick = (e) => {
    const o = sk.opts;
    if (!o || o.steps.length === 0) return;
    const r = bars.getBoundingClientRect();
    seekIndex(Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * o.steps.length));
  };
  return sk;
}

export function renderTimeMachine(el: HTMLElement, opts: TimeMachineOptions): void {
  let sk = skeletons.get(el);
  if (!sk || !el.contains(sk.slider)) {
    sk = build(el);
    skeletons.set(el, sk);
  }
  sk.opts = opts;
  const { steps, at, frame, timeline } = opts;
  const idx = steps.length > 0 ? stepIndex(steps, at) : 0;

  // Harita: bugünkü yerleşim, o tarihin ısısı.
  const files = opts.files.map((f) => ({ ...f, changes: frame.changes.get(f.path) ?? 0 }));
  const skel = sk;
  const drawMap = (): void => {
    renderTreemap(skel.map, files, {
      root: skel.root,
      repoName: opts.repoName,
      highlight: new Set<string>(),
      missing: frame.missing,
      onSelect: (p) => opts.onSelectFile(p),
      onOpen: (p) => opts.onSelectFile(p),
      onNavigate: (folder) => {
        skel.root = folder;
        drawMap();
      },
    });
  };
  if (skel.root !== '' && !files.some((f) => f.path.startsWith(skel.root + '/'))) skel.root = '';
  drawMap();

  // Histogram: her adımda (önceki adım, adım] aralığındaki commit sayısı.
  const counts = steps.map((s, i) => {
    const from = i === 0 ? timeline.start - 1 : steps[i - 1];
    return upperBound(timeline.events, s) - upperBound(timeline.events, from);
  });
  const max = Math.max(1, ...counts);
  const windowStart = at - WINDOW_DAYS * DAY;
  const barFrag = document.createDocumentFragment();
  steps.forEach((s, i) => {
    const b = h('span', 'rr-tm2-bar');
    b.style.setProperty('height', `${Math.max(3, Math.round((counts[i] / max) * 44))}px`);
    const cls = s > windowStart && s <= at ? 'rr-tm2-bar-win' : s <= at ? 'rr-tm2-bar-past' : 'rr-tm2-bar-future';
    b.classList.add(cls);
    if (i === idx) b.classList.add('rr-tm2-bar-cur');
    barFrag.append(b);
  });
  sk.bars.replaceChildren(barFrag);

  // Kaydırıcı (yerinde güncellenir).
  const longAt = longDate(at);
  sk.slider.max = String(Math.max(0, steps.length - 1));
  if (sk.slider.value !== String(idx)) sk.slider.value = String(idx);
  sk.slider.setAttribute('aria-valuetext', longAt);
  sk.slider.disabled = steps.length <= 1;
  sk.dateLabel.textContent = shortDate(at, true);
  sk.prev.disabled = idx <= 0;
  sk.next.disabled = idx >= steps.length - 1;
  sk.play.replaceChildren(icon(opts.playing ? 'codicon-debug-pause' : 'codicon-play'));
  sk.play.setAttribute('aria-label', opts.playing ? 'Duraklat' : 'Oynat');
  sk.play.title = opts.playing ? 'Duraklat' : 'Oynat';
  sk.play.disabled = steps.length <= 1;

  const spanYears = steps.length > 1 && steps[steps.length - 1] - steps[0] > 300 * DAY;
  const tickFrag = document.createDocumentFragment();
  const nTicks = Math.min(TICKS, steps.length);
  for (let k = 0; k < nTicks; k++) {
    const i = nTicks === 1 ? 0 : Math.round((k * (steps.length - 1)) / (nTicks - 1));
    tickFrag.append(h('span', undefined, shortDate(steps[i], spanYears)));
  }
  sk.ticks.replaceChildren(tickFrag);

  renderAside(sk.aside, opts, files, steps, idx);
}

function renderAside(aside: HTMLElement, opts: TimeMachineOptions, files: FileStat[], steps: number[], idx: number): void {
  const { frame, at } = opts;
  const frag = document.createDocumentFragment();

  const head = h('div');
  head.append(h('div', 'rr-tm2-kicker', 'Repo şu tarihte'), h('h2', 'rr-tm2-title', longDate(at)));
  frag.append(head);

  const present = files.filter((f) => !frame.missing.has(f.path)).length;
  const stats = h('div', 'rr-tm2-stats');
  const stat = (label: string, value: string): HTMLElement => {
    const d = h('div', 'rr-tm2-stat');
    d.append(h('div', 'rr-tm2-stat-k', label), h('div', 'rr-tm2-stat-v', value));
    return d;
  };
  stats.append(stat('Dosya', formatNumber(present)), stat(`Son ${WINDOW_DAYS} günde commit`, formatNumber(frame.windowCommits)));
  frag.append(stats);

  // EN SICAK
  const hotBox = h('div', 'rr-tm2-group');
  hotBox.append(h('h3', 'rr-tm2-h3', 'EN SICAK'));
  const levels = heatLevels(files);
  const hottest = files.filter((f) => f.changes > 0).sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path)).slice(0, 5);
  if (hottest.length === 0) {
    hotBox.append(h('div', 'rr-tm2-empty', `Önceki ${WINDOW_DAYS} günde değişiklik yok.`));
  } else {
    const ul = h('ul', 'rr-tm2-list');
    for (const f of hottest) {
      const li = h('li');
      const b = h('button', 'rr-tm2-hot');
      b.type = 'button';
      const level = levels.get(f.path) ?? 0;
      b.setAttribute('aria-label', `${f.path}, ${HEAT_LABELS[level]}, ${formatNumber(f.changes)} commit`);
      b.title = f.path;
      const sw = h('span', 'rr-tm2-swatch');
      sw.setAttribute('aria-hidden', 'true');
      sw.style.setProperty('background', heatVar(level));
      b.append(sw, h('span', 'rr-tm2-hot-name', baseName(f.path)), h('span', 'rr-tm2-hot-heat', `${HEAT_LABELS[level]} · ${formatNumber(f.changes)}`));
      b.onclick = () => opts.onSelectFile(f.path);
      li.append(b);
      ul.append(li);
    }
    hotBox.append(ul);
  }
  frag.append(hotBox);

  // DÖNÜM NOKTALARI
  const marks = opts.timeline.marks;
  if (marks.length > 0) {
    const markBox = h('div', 'rr-tm2-group');
    markBox.append(h('h3', 'rr-tm2-h3', 'DÖNÜM NOKTALARI'));
    const ul = h('ul', 'rr-tm2-list');
    const spanYears = opts.timeline.end - opts.timeline.start > 300 * DAY;
    for (const m of marks) {
      const target = steps.length > 0 ? stepIndex(steps, m.date) : -1;
      const current = target === idx && target >= 0;
      const li = h('li');
      const b = h('button', current ? 'rr-tm2-mark rr-tm2-mark-cur' : 'rr-tm2-mark');
      b.type = 'button';
      if (current) b.setAttribute('aria-current', 'true');
      b.append(icon(markIcon(m)), h('span', 'rr-tm2-mark-date', shortDate(m.date, spanYears)), h('span', 'rr-tm2-mark-text', m.label));
      b.title = `${longDate(m.date)} · ${m.label}`;
      b.onclick = () => opts.onSeek(target >= 0 ? steps[target] : m.date);
      li.append(b);
      ul.append(li);
    }
    markBox.append(ul);
    frag.append(markBox);
  }

  frag.append(h('div', 'rr-tm2-foot', 'Kesik çerçeveli boş kutular o tarihte henüz var olmayan dosyalar.'));

  const scroll = aside.scrollTop;
  const active = document.activeElement;
  const focusText = active instanceof HTMLElement && aside.contains(active) ? active.getAttribute('aria-label') ?? active.title : undefined;
  aside.replaceChildren(frag);
  aside.scrollTop = scroll;
  if (focusText) {
    for (const b of Array.from(aside.querySelectorAll<HTMLElement>('button'))) {
      if ((b.getAttribute('aria-label') ?? b.title) === focusText) {
        b.focus({ preventScroll: true });
        break;
      }
    }
  }
}

function markIcon(m: TimelineMark): string {
  if (m.kind === 'tag') return 'codicon-tag';
  if (m.kind === 'merge') return 'codicon-git-merge';
  return 'codicon-debug-start';
}
