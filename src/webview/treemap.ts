// Repo treemap'i: yol çubuğu + SVG harita + lejant + tooltip. Tasarım: Main.dc.html, Drill.dc.html.
import './treemap.css';
import { hierarchy, treemap, treemapSquarify, type HierarchyNode, type HierarchyRectangularNode } from 'd3-hierarchy';
import type { FileStat } from '../types';
import { HEAT_LABELS, heatLevels, heatVar, type HeatLevel } from './heat';
import { baseName, formatNumber, formatRelative } from './format';

export interface TreemapOptions {
  root: string;            // '' = repo kökü, aksi hâlde 'src/git' gibi klasör yolu
  repoName: string;        // yol çubuğunun kök etiketi
  highlight: Set<string>;  // seçili commit'in dokunduğu dosya yolları (boş = vurgu yok)
  selected?: string;       // seçili dosya yolu
  onSelect: (path: string) => void;      // dosya kutusuna tek tık / Enter
  onOpen: (path: string) => void;        // çift tık
  onNavigate: (folder: string) => void;  // klasöre in / yol çubuğu / üst klasör / Backspace
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEADER = 20;
/** Bundan küçük kutular çizilmez. */
const MIN_BOX = 2;
/** Başlık + içerik sığmayan klasörler tek kutu olarak çizilir. */
const MIN_FOLDER_W = 36;
const MIN_FOLDER_H = HEADER + 14;
const DOUBLE_CLICK_MS = 400;

interface TreeNode {
  name: string;
  /** Repo köküne göre tam yol. */
  path: string;
  file?: FileStat;
  children?: TreeNode[];
}

interface FolderInfo {
  path: string;
  files: number;
  lines: number;
  level: HeatLevel;
  highlighted: number;
}

type RectNode = HierarchyRectangularNode<TreeNode>;

/** Yeniden render'lar arasında yaşayan çift tık takibi (main.ts tek tıkta yeniden çizebilir). */
let lastClick = { path: '', time: 0 };

function parentFolder(folder: string): string {
  const i = folder.lastIndexOf('/');
  return i < 0 ? '' : folder.slice(0, i);
}

function buildTree(files: readonly FileStat[], root: string): TreeNode {
  const top: TreeNode = { name: '', path: root, children: [] };
  const folders = new Map<string, TreeNode>([[root, top]]);
  const prefix = root === '' ? '' : root + '/';
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const parts = f.path.slice(prefix.length).split('/');
    let parent = top;
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      current = current === '' ? parts[i] : current + '/' + parts[i];
      let next = folders.get(current);
      if (!next) {
        next = { name: parts[i], path: current, children: [] };
        folders.set(current, next);
        parent.children?.push(next);
      }
      parent = next;
    }
    parent.children?.push({ name: parts[parts.length - 1], path: f.path, file: f });
  }
  return top;
}

// --- metin ölçme ---------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

function textWidth(text: string, font: string): number {
  const key = font + '|' + text;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  let w = text.length * 7;
  if (measureCtx) {
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
  }
  if (widthCache.size > 20000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

/** Metni maxW'ye sığacak şekilde "…" ile kısaltır; hiç sığmıyorsa ''. */
function fitText(text: string, maxW: number, font: string): string {
  if (textWidth(text, font) <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(text.slice(0, mid) + '…', font) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : text.slice(0, lo) + '…';
}

// --- DOM yardımcıları ----------------------------------------------------

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

function rect(cls: string, x: number, y: number, w: number, hgt: number): SVGRectElement {
  const r = s('rect', cls);
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(Math.max(0, w)));
  r.setAttribute('height', String(Math.max(0, hgt)));
  return r;
}

/** Çerçeveyi kutunun içine çizer (stroke yarısı dışarı taşmasın). */
function insetRect(cls: string, x: number, y: number, w: number, hgt: number, inset: number): SVGRectElement | null {
  if (w <= inset * 2 + 1 || hgt <= inset * 2 + 1) return null;
  return rect(cls, x + inset, y + inset, w - inset * 2, hgt - inset * 2);
}

function svgText(cls: string, x: number, y: number, content: string): SVGTextElement {
  const t = s('text', cls);
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.textContent = content;
  return t;
}

// --- ana render ----------------------------------------------------------

export function renderTreemap(el: HTMLElement, files: FileStat[], opts: TreemapOptions): void {
  const { root, highlight, selected } = opts;
  const levels = heatLevels(files);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const prefix = root === '' ? '' : root + '/';
  const inRoot = files.filter((f) => f.path.startsWith(prefix));
  const hasHighlight = highlight.size > 0;
  let outside = 0;
  if (hasHighlight) {
    for (const p of highlight) if (byPath.has(p) && !p.startsWith(prefix)) outside++;
  }

  el.replaceChildren();
  el.classList.add('rr-tm');

  // Yol çubuğu
  const bar = h('nav', 'rr-tm-path');
  bar.setAttribute('aria-label', 'Konum');
  const up = h('button', 'rr-tm-up');
  up.type = 'button';
  const upTarget = parentFolder(root);
  up.setAttribute('aria-label', root === '' ? 'Üst klasöre çık' : `Üst klasöre çık: ${upTarget === '' ? opts.repoName : upTarget}`);
  up.title = 'Üst klasöre çık (Backspace)';
  up.disabled = root === '';
  up.append(icon('codicon-chevron-left'));
  up.onclick = () => opts.onNavigate(upTarget);
  bar.append(up);

  const crumbs = h('span', 'rr-tm-crumbs');
  const segs = root === '' ? [] : root.split('/');
  const addCrumb = (label: string, target: string, last: boolean): void => {
    if (last) {
      const cur = h('span', 'rr-tm-crumb-current', label);
      cur.setAttribute('aria-current', 'location');
      crumbs.append(cur);
    } else {
      const b = h('button', 'rr-tm-crumb', label);
      b.type = 'button';
      b.onclick = () => opts.onNavigate(target);
      crumbs.append(b);
      const sep = h('span', 'rr-tm-sep', '›');
      sep.setAttribute('aria-hidden', 'true');
      crumbs.append(sep);
    }
  };
  addCrumb(opts.repoName, '', segs.length === 0);
  segs.forEach((seg, i) => addCrumb(seg, segs.slice(0, i + 1).join('/'), i === segs.length - 1));
  bar.append(crumbs);

  const meta = h('span', 'rr-tm-meta');
  if (outside > 0) {
    const note = h('span', 'rr-tm-outside');
    note.append(icon('codicon-info'), document.createTextNode(` Bu commit'in ${formatNumber(outside)} dosyası bu klasörün dışında`));
    meta.append(note);
  }
  meta.append(h('span', 'rr-tm-count', `${formatNumber(inRoot.length)} dosya · kutu boyutu = satır sayısı`));
  bar.append(meta);
  el.append(bar);

  // Harita alanı
  const area = h('div', 'rr-tm-area');
  el.append(area);

  // Lejant
  el.append(legend(hasHighlight));

  // Tooltip (fixed; pencereye göre konumlanır)
  const tip = h('div', 'rr-tm-tip');
  tip.setAttribute('role', 'tooltip');
  tip.id = 'rr-tm-tip';
  tip.hidden = true;
  el.append(tip);

  if (inRoot.length === 0) {
    area.append(h('div', 'rr-tm-empty', root === '' ? 'Gösterilecek dosya yok.' : 'Bu klasörde gösterilecek dosya yok.'));
    installHandlers(el, opts, byPath, new Map(), levels, tip);
    return;
  }

  const width = Math.floor(area.clientWidth);
  const height = Math.floor(area.clientHeight);
  const folderInfo = new Map<string, FolderInfo>();

  const svg = s('svg', 'rr-tm-svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', `${root === '' ? opts.repoName : root} haritası`);
  area.append(svg);

  if (width < MIN_BOX || height < MIN_BOX) {
    installHandlers(el, opts, byPath, folderInfo, levels, tip);
    return;
  }

  const tree: HierarchyNode<TreeNode> = hierarchy(buildTree(files, root), (d) => d.children)
    .sum((d) => (d.file ? Math.max(1, d.file.lines) : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const laid: RectNode = treemap<TreeNode>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(1)
    .paddingOuter((n) => (n.depth === 0 ? 0 : 1))
    .paddingTop((n) => (n.depth === 0 ? 0 : HEADER))
    .round(true)(tree);

  // Klasör özetleri (en sıcak seviye, dosya/satır sayısı, vurgulu dosya sayısı)
  laid.eachAfter((n) => {
    if (!n.children) return;
    let filesN = 0;
    let lines = 0;
    let level = 0;
    let hl = 0;
    for (const c of n.children) {
      if (c.data.file) {
        filesN++;
        lines += c.data.file.lines;
        level = Math.max(level, levels.get(c.data.path) ?? 0);
        if (highlight.has(c.data.path)) hl++;
      } else {
        const fi = folderInfo.get(c.data.path);
        if (fi) {
          filesN += fi.files;
          lines += fi.lines;
          level = Math.max(level, fi.level);
          hl += fi.highlighted;
        }
      }
    }
    folderInfo.set(n.data.path, { path: n.data.path, files: filesN, lines, level: level as HeatLevel, highlighted: hl });
  });

  const nameFont = `600 12px ${fontFamily(el)}`;
  const subFont = `11px ${fontFamily(el)}`;
  const headFont = `600 11px ${fontFamily(el)}`;
  const frag = document.createDocumentFragment();
  // Seçim/vurgu çerçeveleri kutuların üstünde kalsın diye ayrı katmanda.
  const overlay = document.createDocumentFragment();

  const drawBoxLabel = (g: SVGGElement, x: number, y: number, w: number, hgt: number, name: string, sub: string | null, hot: boolean): void => {
    if (w < 60 || hgt < 22) return;
    const cls = hot ? 'rr-tm-label rr-tm-onhot' : 'rr-tm-label';
    const fitted = fitText(name, w - 14, nameFont);
    if (fitted) g.append(svgText(cls + ' rr-tm-name', x + 7, y + 17, fitted));
    if (sub && hgt >= 40 && w >= 90) {
      const subFitted = fitText(sub, w - 14, subFont);
      if (subFitted) g.append(svgText(cls + ' rr-tm-sub', x + 7, y + 33, subFitted));
    }
  };

  const visit = (n: RectNode): void => {
    const x = n.x0;
    const y = n.y0;
    const w = n.x1 - n.x0;
    const hgt = n.y1 - n.y0;
    if (w < MIN_BOX || hgt < MIN_BOX) return;

    if (n.data.file) {
      const f = n.data.file;
      const level = levels.get(f.path) ?? 0;
      const isSel = f.path === selected;
      const isHl = highlight.has(f.path);
      const g = node('file', f.path, `${baseName(f.path)}, ${formatNumber(f.lines)} satır, ${formatNumber(f.changes)} commit`);
      g.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      if (hasHighlight && !isHl) g.classList.add('rr-tm-dim');
      const box = rect(level === 0 ? 'rr-tm-box rr-tm-cold' : 'rr-tm-box', x, y, w, hgt);
      box.style.setProperty('fill', heatVar(level));
      g.append(box);
      drawBoxLabel(g, x, y, w, hgt, baseName(f.path), `${formatNumber(f.lines)} satır · ${formatNumber(f.changes)} commit`, level >= 4);
      frag.append(g);
      addMarks(overlay, x, y, w, hgt, isSel, hasHighlight && isHl);
      return;
    }

    const info = folderInfo.get(n.data.path);
    if (n.depth > 0 && info) {
      const collapsed = w < MIN_FOLDER_W || hgt < MIN_FOLDER_H;
      const label = `${n.data.name}/ klasörü, ${formatNumber(info.files)} dosya, ${formatNumber(info.lines)} satır`;
      if (collapsed) {
        const g = node('folder', n.data.path, `${label}, içine in`);
        if (hasHighlight && info.highlighted === 0) g.classList.add('rr-tm-dim');
        const box = rect(info.level === 0 ? 'rr-tm-box rr-tm-cold' : 'rr-tm-box', x, y, w, hgt);
        box.style.setProperty('fill', heatVar(info.level));
        g.append(box);
        drawBoxLabel(g, x, y, w, hgt, n.data.name + '/', `${formatNumber(info.files)} dosya`, info.level >= 4);
        frag.append(g);
        addMarks(overlay, x, y, w, hgt, false, hasHighlight && info.highlighted > 0);
        return;
      }
      const g = node('folder', n.data.path, `${label}, içine in`);
      g.classList.add('rr-tm-folder');
      g.append(rect('rr-tm-head', x, y, w, HEADER));
      const headText = fitText(n.data.name, w - 12, headFont);
      if (headText) g.append(svgText('rr-tm-headlabel', x + 6, y + 14, headText));
      frag.append(g);
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(laid);
  svg.append(frag, overlay);

  installHandlers(el, opts, byPath, folderInfo, levels, tip);
}

function node(kind: 'file' | 'folder', path: string, label: string): SVGGElement {
  const g = s('g', 'rr-tm-node');
  g.setAttribute('role', 'button');
  g.setAttribute('tabindex', '0');
  g.setAttribute('aria-label', label);
  g.setAttribute('aria-describedby', 'rr-tm-tip');
  g.dataset.kind = kind;
  g.dataset.path = path;
  return g;
}

function addMarks(layer: DocumentFragment, x: number, y: number, w: number, hgt: number, isSel: boolean, isHl: boolean): void {
  if (isHl) {
    const r = insetRect('rr-tm-hl', x, y, w, hgt, isSel ? 3 : 1);
    if (r) layer.append(r);
  }
  if (isSel) {
    const r = insetRect('rr-tm-sel', x, y, w, hgt, 1);
    if (r) layer.append(r);
    const o = insetRect('rr-tm-sel-hc', x, y, w, hgt, isHl ? 5 : 3.5);
    if (o) layer.append(o);
  }
}

function icon(name: string): HTMLSpanElement {
  const i = h('span', `codicon ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function fontFamily(el: HTMLElement): string {
  return getComputedStyle(el).fontFamily || 'sans-serif';
}

function legend(hasHighlight: boolean): HTMLElement {
  const lg = h('div', 'rr-tm-legend');
  lg.setAttribute('aria-label', 'Lejant');
  lg.setAttribute('role', 'group');

  const scale = h('span', 'rr-tm-legend-item');
  scale.append(document.createTextNode('Az değişen'));
  const sw = h('span', 'rr-tm-scale');
  sw.setAttribute('aria-hidden', 'true');
  for (let i = 1 as HeatLevel; i <= 5; i = (i + 1) as HeatLevel) {
    const c = h('span', 'rr-tm-scale-step');
    c.style.setProperty('background', heatVar(i));
    sw.append(c);
  }
  scale.append(sw, document.createTextNode('Sık değişen'));
  lg.append(scale);

  const cold = h('span', 'rr-tm-legend-item');
  const coldSw = h('span', 'rr-tm-swatch rr-tm-swatch-cold');
  coldSw.setAttribute('aria-hidden', 'true');
  cold.append(coldSw, document.createTextNode(HEAT_LABELS[0]));
  lg.append(cold);

  const sel = h('span', 'rr-tm-legend-item');
  const selSw = h('span', 'rr-tm-swatch rr-tm-swatch-sel');
  selSw.setAttribute('aria-hidden', 'true');
  sel.append(selSw, document.createTextNode('Seçili dosya'));
  lg.append(sel);

  if (hasHighlight) {
    const hl = h('span', 'rr-tm-legend-item');
    const hlSw = h('span', 'rr-tm-swatch rr-tm-swatch-hl');
    hlSw.setAttribute('aria-hidden', 'true');
    hl.append(hlSw, document.createTextNode("Commit'in dokunduğu dosyalar (diğerleri soluk)"));
    lg.append(hl);
  }
  return lg;
}

// --- olaylar -------------------------------------------------------------

function installHandlers(
  el: HTMLElement,
  opts: TreemapOptions,
  byPath: Map<string, FileStat>,
  folderInfo: Map<string, FolderInfo>,
  levels: Map<string, HeatLevel>,
  tip: HTMLDivElement,
): void {
  const target = (e: Event): SVGGElement | null => {
    const t = e.target;
    if (!(t instanceof Element)) return null;
    const n = t.closest('.rr-tm-node');
    return n instanceof SVGGElement ? n : null;
  };
  const activate = (n: SVGGElement): void => {
    const path = n.dataset.path ?? '';
    if (n.dataset.kind === 'folder') opts.onNavigate(path);
    else opts.onSelect(path);
  };

  el.onclick = (e) => {
    const n = target(e);
    if (!n) return;
    const path = n.dataset.path ?? '';
    const now = Date.now();
    if (n.dataset.kind === 'file' && lastClick.path === path && now - lastClick.time < DOUBLE_CLICK_MS) {
      lastClick = { path: '', time: 0 };
      opts.onOpen(path);
      return;
    }
    lastClick = { path, time: now };
    activate(n);
  };

  el.onkeydown = (e) => {
    if (e.key === 'Backspace') {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (opts.root !== '') opts.onNavigate(parentFolder(opts.root));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const n = target(e);
      if (!n) return;
      e.preventDefault();
      activate(n);
    }
  };

  let shown: SVGGElement | null = null;
  const show = (n: SVGGElement, x: number, y: number): void => {
    if (shown !== n) {
      shown = n;
      fillTip(tip, n, byPath, folderInfo, levels);
    }
    tip.hidden = false;
    place(tip, x, y);
  };
  const hide = (): void => {
    shown = null;
    tip.hidden = true;
  };

  el.onmousemove = (e) => {
    const n = target(e);
    if (!n) return hide();
    show(n, e.clientX, e.clientY);
  };
  el.onmouseleave = hide;
  // focusin/focusout için on* özelliği yok; önceki dinleyiciyi kaldırıp yenisini ekle.
  const onFocusIn = (e: FocusEvent): void => {
    const n = target(e);
    if (!n) return hide();
    const r = n.getBoundingClientRect();
    show(n, r.left + Math.min(r.width / 2, 40), r.top + Math.min(r.height / 2, 30));
  };
  const prev = focusHandlers.get(el);
  if (prev) {
    el.removeEventListener('focusin', prev.in);
    el.removeEventListener('focusout', prev.out);
  }
  el.addEventListener('focusin', onFocusIn);
  el.addEventListener('focusout', hide);
  focusHandlers.set(el, { in: onFocusIn, out: hide });
}

const focusHandlers = new WeakMap<HTMLElement, { in: (e: FocusEvent) => void; out: () => void }>();

function fillTip(
  tip: HTMLDivElement,
  n: SVGGElement,
  byPath: Map<string, FileStat>,
  folderInfo: Map<string, FolderInfo>,
  levels: Map<string, HeatLevel>,
): void {
  const path = n.dataset.path ?? '';
  tip.replaceChildren();
  const head = h('div', 'rr-tm-tip-head');
  const stat = (label: string, value: string): HTMLDivElement => {
    const d = h('div');
    d.append(h('div', 'rr-tm-tip-k', label), h('div', 'rr-tm-tip-v', value));
    return d;
  };
  const grid = h('div', 'rr-tm-tip-grid');

  if (n.dataset.kind === 'file') {
    const f = byPath.get(path);
    if (!f) return;
    head.append(h('div', 'rr-tm-tip-name', baseName(f.path)), h('div', 'rr-tm-tip-path', f.path));
    grid.append(
      stat('Satır', formatNumber(f.lines)),
      stat('Commit', formatNumber(f.changes)),
      stat('Sıklık', HEAT_LABELS[levels.get(f.path) ?? 0]),
    );
    const delta = h('div', 'rr-tm-tip-row');
    delta.append(
      h('span', 'rr-tm-tip-k', 'Değişim: '),
      h('span', 'rr-tm-tip-add', `+${formatNumber(f.added)}`),
      document.createTextNode(' '),
      h('span', 'rr-tm-tip-del', `−${formatNumber(f.deleted)}`),
    );
    const last = h('div', 'rr-tm-tip-row rr-tm-tip-sep');
    last.append(h('span', 'rr-tm-tip-k', 'Son dokunma: '), document.createTextNode(formatRelative(f.lastModified, Date.now())));
    const authors = h('div', 'rr-tm-tip-row');
    const shownAuthors = f.authors.slice(0, 3).join(', ') + (f.authors.length > 3 ? ` +${f.authors.length - 3}` : '');
    authors.append(h('span', 'rr-tm-tip-k', 'Yazarlar: '), document.createTextNode(shownAuthors || '—'));
    tip.append(head, grid, last, delta, authors, h('div', 'rr-tm-tip-hint', 'Tıkla: dosya kartı · Çift tıkla: dosyayı aç'));
    return;
  }

  const info = folderInfo.get(path);
  head.append(h('div', 'rr-tm-tip-name', baseName(path) + '/'), h('div', 'rr-tm-tip-path', path));
  grid.append(
    stat('Dosya', formatNumber(info?.files ?? 0)),
    stat('Satır', formatNumber(info?.lines ?? 0)),
    stat('En sıcak', HEAT_LABELS[info?.level ?? 0]),
  );
  tip.append(head, grid, h('div', 'rr-tm-tip-hint', 'Tıkla: klasörün içine in'));
}

/** Tooltip'i imlecin sağ altına koyar; pencereden taşarsa ters tarafa geçer. */
function place(tip: HTMLDivElement, x: number, y: number): void {
  const gap = 12;
  const margin = 8;
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let left = x + gap;
  if (left + w > vw - margin) left = x - gap - w;
  left = Math.max(margin, Math.min(left, vw - margin - w));
  let top = y + gap;
  if (top + hgt > vh - margin) top = y - gap - hgt;
  top = Math.max(margin, Math.min(top, vh - margin - hgt));
  tip.style.setProperty('left', `${Math.round(left)}px`);
  tip.style.setProperty('top', `${Math.round(top)}px`);
}
