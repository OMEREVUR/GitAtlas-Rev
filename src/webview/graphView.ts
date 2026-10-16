// Commit graph listesi: şeritler (SVG), ref etiketleri, sanal kaydırma, sonsuz yükleme. Tasarım: Graph.dc.html.
import './graph.css';
import type { CiState, CommitSummary, GitRef, GraphData, GraphRow } from '../types';
import { formatRelative } from './format';

export interface GraphViewOptions {
  plain: boolean;                 // true: şerit sütunu gizli ("Sade liste")
  selectedHash?: string;
  branchHashes?: Set<string>;     // seçili branch'in commit'leri: satırlar hafif vurgulu (list-hoverBackground)
  visible?: Set<string>;          // filtre sonucu; undefined = hepsi. Doluyken yalnızca bu satırlar çizilir
  now: number;
  loadingMore: boolean;
  onSelectCommit: (hash: string | undefined) => void;   // seçili satıra ikinci tık → undefined
  onLoadMore: () => void;
  /** v3: branch → açık PR'lar. Anahtar: lokal branch adı ya da remote branch'in "origin/" sonrası. */
  prsByBranch?: Map<string, { number: number; ci: CiState; url: string }[]>;
}

const CI_TEXT: Record<CiState, string> = { success: 'CI geçti', failure: 'CI başarısız', pending: 'CI sürüyor', none: 'CI yok' };

/** Ref'in PR eşlemesindeki anahtarı: lokal ad ya da remote'un ilk "/" sonrası. */
function prKey(r: GitRef): string | undefined {
  if (r.kind === 'local') return r.name;
  if (r.kind === 'remote') {
    const i = r.name.indexOf('/');
    return i < 0 ? r.name : r.name.slice(i + 1);
  }
  return undefined;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ROW_H = 32;
const LANE_W = 16;
const LANE_X0 = 14;
/** Görünür pencerenin üstüne/altına fazladan çizilen satır sayısı. */
const OVERSCAN = 12;
/** Bir satırda gösterilen en fazla ref etiketi; fazlası "+N". */
const MAX_REFS = 3;

const X = (lane: number): number => LANE_X0 + lane * LANE_W;
const Y = (row: number): number => row * ROW_H + ROW_H / 2;
const laneColor = (color: number): string => `var(--vscode-scmGraph-foreground${(((color % 5) + 5) % 5) + 1})`;

interface Segment {
  /** Kapsadığı satır aralığı (y ekseninde). */
  from: number;
  to: number;
  d: string;
  color: number;
}

/** el başına yeniden render'lar arasında yaşayan durum. */
interface ViewState {
  observer?: IntersectionObserver;
  lastSelected?: string;
  /** Klavye odağının bulunduğu commit (sanal kaydırmada satır DOM'dan çıksa da hatırlanır). */
  focusHash?: string;
}
const states = new WeakMap<HTMLElement, ViewState>();

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function s<K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  if (cls) e.setAttribute('class', cls);
  return e;
}

function icon(name: string): HTMLSpanElement {
  const i = h('span', `codicon ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Kenarları satır aralıklı parçalara böler; pencere çiziminde yalnızca kesişenler kullanılır. */
function buildSegments(graph: GraphData): Segment[] {
  const segs: Segment[] = [];
  const bottom = graph.layout.rows.length;
  for (const e of graph.layout.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1];
      const b = e.points[i];
      const x1 = X(a.lane);
      const y1 = Y(a.row);
      const x2 = X(b.lane);
      // Parent yüklenmemiş: alt kenara kadar.
      const y2 = b.row >= bottom ? bottom * ROW_H : Y(b.row);
      const d = a.lane === b.lane
        ? `M${x1} ${y1}L${x2} ${y2}`
        : `M${x1} ${y1}C${x1} ${y1 + ROW_H / 2} ${x2} ${y2 - ROW_H / 2} ${x2} ${y2}`;
      segs.push({ from: a.row, to: Math.min(b.row, bottom), d, color: e.color });
    }
  }
  return segs;
}

export function renderGraph(el: HTMLElement, graph: GraphData, opts: GraphViewOptions): void {
  let st = states.get(el);
  if (!st) {
    st = {};
    states.set(el, st);
  }
  const state = st;

  // Önceki render'dan kaydırma ve odak.
  const prevScroller = el.querySelector<HTMLElement>('.rr-g-scroll');
  const prevScroll = prevScroller ? prevScroller.scrollTop : 0;
  const active = document.activeElement;
  const hadFocus = active instanceof HTMLElement && el.contains(active);
  const focusedHash = hadFocus && active.dataset.hash ? active.dataset.hash : undefined;
  if (focusedHash) state.focusHash = focusedHash;
  state.observer?.disconnect();
  state.observer = undefined;

  const filtered = opts.visible !== undefined;
  const showGraph = !opts.plain && !filtered;
  const rowsByHash = new Map<string, GraphRow>();
  graph.layout.rows.forEach((r) => rowsByHash.set(r.hash, r));
  const list: CommitSummary[] = filtered ? graph.commits.filter((c) => opts.visible?.has(c.hash)) : graph.commits;
  const indexOf = new Map<string, number>();
  list.forEach((c, i) => indexOf.set(c.hash, i));

  const refsByHash = new Map<string, GitRef[]>();
  const kindOrder = { local: 0, remote: 1, tag: 2 } as const;
  for (const r of graph.refs) {
    const arr = refsByHash.get(r.hash);
    if (arr) arr.push(r);
    else refsByHash.set(r.hash, [r]);
  }
  for (const arr of refsByHash.values()) {
    arr.sort((a, b) => Number(b.isHead) - Number(a.isHead) || kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name));
  }

  // En az 44px: tek şeritte "Graph" başlığı kesilmesin.
  const graphW = showGraph ? Math.max(44, LANE_X0 + Math.max(1, graph.layout.laneCount) * LANE_W) : 8;
  el.replaceChildren();
  el.classList.add('rr-g');
  el.style.setProperty('--rr-g-gw', `${graphW}px`);

  // Başlık
  const head = h('div', 'rr-g-head rr-g-grid');
  head.setAttribute('aria-hidden', 'true');
  head.append(
    h('span', 'rr-g-c-graph', showGraph ? 'Graph' : ''),
    h('span', 'rr-g-c-msg', 'Mesaj'),
    h('span', 'rr-g-c-author', 'Yazar'),
    h('span', 'rr-g-c-date', 'Tarih'),
    h('span', 'rr-g-c-hash', 'Hash'),
  );
  el.append(head);

  const scroller = h('div', 'rr-g-scroll');
  el.append(scroller);

  if (list.length === 0) {
    scroller.append(h('div', 'rr-g-empty', filtered ? 'Filtreyle eşleşen commit yok' : 'Gösterilecek commit yok'));
    if (graph.hasMore) scroller.append(footer(graph, opts, state, scroller));
    installKeys(el, opts, list, indexOf, state, () => undefined);
    return;
  }

  const body = h('div', 'rr-g-body');
  body.style.setProperty('height', `${list.length * ROW_H}px`);
  const ol = h('ol', 'rr-g-list');
  ol.setAttribute('aria-label', "Commit'ler");
  body.append(ol);
  let svg: SVGSVGElement | null = null;
  const segments = showGraph ? buildSegments(graph) : [];
  if (showGraph) {
    svg = s('svg', 'rr-g-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', String(graphW));
    svg.setAttribute('height', String(list.length * ROW_H));
    body.append(svg);
  }
  scroller.append(body, footer(graph, opts, state, scroller));

  const tabHash = (): string | undefined => {
    if (state.focusHash && indexOf.has(state.focusHash)) return state.focusHash;
    if (opts.selectedHash && indexOf.has(opts.selectedHash)) return opts.selectedHash;
    return list[0]?.hash;
  };

  let drawn = { from: -1, to: -1 };
  const drawWindow = (force = false): void => {
    const viewH = scroller.clientHeight || ROW_H * 20;
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(list.length - 1, Math.ceil((scroller.scrollTop + viewH) / ROW_H) + OVERSCAN);
    if (!force && first === drawn.from && last === drawn.to) return;
    drawn = { from: first, to: last };
    const keep = document.activeElement instanceof HTMLElement && ol.contains(document.activeElement) ? document.activeElement.dataset.hash : undefined;
    const tab = tabHash();
    const frag = document.createDocumentFragment();
    for (let i = first; i <= last; i++) {
      frag.append(rowItem(list[i], i, list.length, graph, opts, refsByHash.get(list[i].hash) ?? [], rowsByHash.get(list[i].hash), tab));
    }
    ol.replaceChildren(frag);
    if (keep) ol.querySelector<HTMLElement>(`[data-hash="${keep}"]`)?.focus({ preventScroll: true });
    if (svg) drawGraph(svg, graph, segments, first, last, opts.selectedHash);
  };

  // Kaydırma konumunu geri yükle; seçim değiştiyse ve görünmüyorsa seçili satıra kaydır.
  scroller.scrollTop = prevScroll;
  if (opts.selectedHash && opts.selectedHash !== state.lastSelected) {
    const idx = indexOf.get(opts.selectedHash);
    const viewH = scroller.clientHeight;
    if (idx !== undefined && viewH > 0) {
      const top = idx * ROW_H;
      if (top < scroller.scrollTop || top + ROW_H > scroller.scrollTop + viewH) {
        scroller.scrollTop = Math.max(0, top - viewH / 2 + ROW_H / 2);
      }
    }
  }
  state.lastSelected = opts.selectedHash;

  let raf = 0;
  scroller.onscroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      drawWindow();
    });
  };
  drawWindow(true);

  if (hadFocus && state.focusHash) {
    ol.querySelector<HTMLElement>(`[data-hash="${state.focusHash}"]`)?.focus({ preventScroll: true });
  }

  const focusIndex = (i: number): void => {
    const idx = Math.max(0, Math.min(list.length - 1, i));
    const top = idx * ROW_H;
    const viewH = scroller.clientHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H > scroller.scrollTop + viewH) scroller.scrollTop = top + ROW_H - viewH;
    state.focusHash = list[idx].hash;
    drawWindow(true);
    ol.querySelector<HTMLElement>(`[data-hash="${list[idx].hash}"]`)?.focus({ preventScroll: true });
  };
  installKeys(el, opts, list, indexOf, state, focusIndex);

  el.onclick = (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest<HTMLButtonElement>('.rr-g-row');
    if (!btn?.dataset.hash) return;
    state.focusHash = btn.dataset.hash;
    opts.onSelectCommit(btn.dataset.hash === opts.selectedHash ? undefined : btn.dataset.hash);
  };
}

function installKeys(
  el: HTMLElement,
  opts: GraphViewOptions,
  list: CommitSummary[],
  indexOf: Map<string, number>,
  state: ViewState,
  focusIndex: (i: number) => void,
): void {
  el.onkeydown = (e) => {
    if (e.key === 'Escape') {
      if (opts.selectedHash !== undefined) {
        e.preventDefault();
        opts.onSelectCommit(undefined);
      }
      return;
    }
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains('rr-g-row') || list.length === 0) return;
    const cur = indexOf.get(t.dataset.hash ?? '') ?? 0;
    let next: number | undefined;
    if (e.key === 'ArrowDown') next = cur + 1;
    else if (e.key === 'ArrowUp') next = cur - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'PageDown') next = cur + 10;
    else if (e.key === 'PageUp') next = cur - 10;
    if (next === undefined) return;
    e.preventDefault();
    state.focusHash = list[Math.max(0, Math.min(list.length - 1, next))]?.hash;
    focusIndex(next);
  };
}

function rowItem(
  c: CommitSummary,
  index: number,
  total: number,
  graph: GraphData,
  opts: GraphViewOptions,
  refs: GitRef[],
  row: GraphRow | undefined,
  tabHash: string | undefined,
): HTMLLIElement {
  const li = h('li', 'rr-g-li');
  li.style.setProperty('top', `${index * ROW_H}px`);
  li.setAttribute('aria-posinset', String(index + 1));
  li.setAttribute('aria-setsize', String(total));

  const isSel = c.hash === opts.selectedHash;
  const isMerge = c.parents.length > 1;
  const isHead = graph.head === c.hash;
  const btn = h('button', 'rr-g-row rr-g-grid');
  btn.type = 'button';
  btn.dataset.hash = c.hash;
  btn.tabIndex = c.hash === tabHash ? 0 : -1;
  btn.setAttribute('aria-pressed', isSel ? 'true' : 'false');
  if (isSel) btn.classList.add('rr-g-selected');
  else if (opts.branchHashes?.has(c.hash)) btn.classList.add('rr-g-inbranch');

  const refNames = refs.map((r) => r.name);
  const ariaParts = [
    c.message,
    c.author,
    formatRelative(c.date, opts.now),
    c.shortHash,
  ];
  if (isMerge) ariaParts.push(c.parents.length > 2 ? `merge (${c.parents.length} parent)` : 'merge');
  if (isHead) ariaParts.push('HEAD');
  if (refNames.length) ariaParts.push(`ref: ${refNames.join(', ')}`);
  // Bu satırdaki ref'lere bağlı PR'lar (lokal + remote aynı PR'ı iki kez göstermesin).
  const prsByRef = new Map<GitRef, { number: number; ci: CiState; url: string }[]>();
  if (opts.prsByBranch) {
    const seen = new Set<number>();
    for (const r of refs) {
      const key = prKey(r);
      const prs = key ? opts.prsByBranch.get(key) : undefined;
      if (!prs) continue;
      const fresh = prs.filter((p) => !seen.has(p.number));
      fresh.forEach((p) => seen.add(p.number));
      if (fresh.length) prsByRef.set(r, fresh);
    }
    for (const prs of prsByRef.values()) {
      for (const p of prs) ariaParts.push(p.ci === 'none' ? `PR #${p.number}` : `PR #${p.number}, ${CI_TEXT[p.ci]}`);
    }
  }
  btn.setAttribute('aria-label', ariaParts.join(', '));
  btn.title = c.message;

  const msg = h('span', 'rr-g-c-msg');
  if (isHead) {
    const headTag = h('span', 'rr-g-ref rr-g-ref-head');
    headTag.append(h('span', 'rr-g-ref-text', 'HEAD'));
    msg.append(headTag);
  }
  const color = laneColor(row?.color ?? 0);
  for (const r of refs.slice(0, MAX_REFS)) {
    const tag = h('span', `rr-g-ref rr-g-ref-${r.kind}`);
    tag.style.setProperty('--rr-g-lane', color);
    if (r.kind === 'tag') tag.append(icon('codicon-tag'));
    tag.append(h('span', 'rr-g-ref-text', r.name));
    tag.title = r.kind === 'remote' ? `${r.name} (remote)` : r.kind === 'tag' ? `${r.name} (etiket)` : r.name;
    if (r.isHead) tag.classList.add('rr-g-ref-current');
    msg.append(tag);
    for (const p of prsByRef.get(r) ?? []) {
      const chip = h('span', 'rr-g-pr');
      chip.title = p.ci === 'none' ? `PR #${p.number}` : `PR #${p.number} · ${CI_TEXT[p.ci]}`;
      chip.append(h('span', 'rr-g-ref-text', `#${p.number}`));
      if (p.ci !== 'none') {
        const dot = h('span', `rr-g-ci rr-g-ci-${p.ci}`);
        dot.setAttribute('aria-hidden', 'true');
        chip.append(dot);
      }
      msg.append(chip);
    }
  }
  if (refs.length > MAX_REFS) {
    const more = h('span', 'rr-g-ref rr-g-ref-more', `+${refs.length - MAX_REFS}`);
    more.title = refs.slice(MAX_REFS).map((r) => r.name).join(', ');
    msg.append(more);
  }
  msg.append(h('span', 'rr-g-msgtext', c.message));

  btn.append(
    h('span', 'rr-g-c-graph'),
    msg,
    h('span', 'rr-g-c-author', c.author),
    h('span', 'rr-g-c-date', formatRelative(c.date, opts.now)),
    h('code', 'rr-g-c-hash', c.shortHash),
  );
  li.append(btn);
  return li;
}

function drawGraph(svg: SVGSVGElement, graph: GraphData, segments: Segment[], first: number, last: number, selected?: string): void {
  const frag = document.createDocumentFragment();
  // Kenarlar renk başına tek path'te birleştirilir (DOM öğesi sayısı az kalsın).
  const byColor = new Map<number, string[]>();
  for (const seg of segments) {
    if (seg.to < first - 1 || seg.from > last + 1) continue;
    const arr = byColor.get(seg.color);
    if (arr) arr.push(seg.d);
    else byColor.set(seg.color, [seg.d]);
  }
  for (const [color, ds] of byColor) {
    const p = s('path', 'rr-g-edge');
    p.setAttribute('d', ds.join(''));
    p.style.setProperty('stroke', laneColor(color));
    frag.append(p);
  }
  for (let i = first; i <= last; i++) {
    const row = graph.layout.rows[i];
    const commit = graph.commits[i];
    if (!row || !commit) continue;
    const cx = X(row.lane);
    const cy = Y(i);
    if (row.hash === selected) {
      const ring = s('circle', 'rr-g-ring');
      ring.setAttribute('cx', String(cx));
      ring.setAttribute('cy', String(cy));
      ring.setAttribute('r', '8');
      frag.append(ring);
    }
    const dot = s('circle', row.isMerge ? 'rr-g-dot rr-g-merge' : 'rr-g-dot');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', graph.head === row.hash ? '5' : '4');
    dot.style.setProperty(row.isMerge ? 'stroke' : 'fill', laneColor(row.color));
    frag.append(dot);
  }
  svg.replaceChildren(frag);
}

function footer(graph: GraphData, opts: GraphViewOptions, state: ViewState, scroller: HTMLElement): HTMLElement {
  const f = h('div', 'rr-g-foot');
  if (!graph.hasMore) {
    f.append(icon('codicon-history'), document.createTextNode(' Geçmişin başı'));
    return f;
  }
  const btn = h('button', 'rr-g-more');
  btn.type = 'button';
  if (opts.loadingMore) {
    btn.disabled = true;
    btn.append(icon('codicon-loading codicon-modifier-spin'), document.createTextNode(' Yükleniyor…'));
  } else {
    btn.textContent = "Daha eski commit'leri yükle";
    btn.onclick = () => opts.onLoadMore();
    if (typeof IntersectionObserver !== 'undefined') {
      let fired = false;
      const io = new IntersectionObserver(
        (entries) => {
          if (fired || !entries.some((en) => en.isIntersecting)) return;
          fired = true;
          io.disconnect();
          opts.onLoadMore();
        },
        { root: scroller, rootMargin: '0px 0px 200px 0px' },
      );
      io.observe(f);
      state.observer = io;
    }
  }
  f.append(btn);
  return f;
}
