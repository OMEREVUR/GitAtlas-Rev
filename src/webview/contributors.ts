// Katkı paneli (tasarım: Contributors.dc.html): modül sahipliği, haftalık ritim, dosya uzmanı, yazarlar.
import type { AuthorStat, ContribData, ModuleOwnership } from '../types';
import { baseName, formatNumber } from './format';

export interface ContributorsOptions {
  data: ContribData;
  selectedAuthor?: string;
  now: number;
  onSelectAuthor: (key: string | undefined) => void;
  onSelectFile: (path: string) => void;
}

/** scmGraph-foreground1..5 ile renklenen yazar sayısı; fazlası "diğer". */
const COLORED = 5;
const LABEL_MIN_PCT = 15;
const RISK_PCT = 80;
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const DAY_MS = 24 * 3600_000;
const OTHER = '\u0000diğer';

const RANGE_TITLE = { '7d': 'Son 7 gün', '30d': 'Son 30 gün', all: 'Tüm geçmiş' } as const;

interface Who {
  key: string;
  name: string;
  /** 0..4 → --vscode-scmGraph-foreground1..5; -1 → diğer (gri). */
  color: number;
}

export function renderContributors(el: HTMLElement, opts: ContributorsOptions): void {
  el.classList.add('rr-ct');
  const { data } = opts;
  const prevScroll = el.scrollTop;

  // Yazar kimliği: shares/experts'te anahtar (AuthorStat.key) beklenir; ada göre de eşlenir.
  const whos = new Map<string, Who>();
  data.authors.forEach((a, i) => {
    const who: Who = { key: a.key, name: a.name, color: i < COLORED ? i : -1 };
    whos.set(a.key, who);
    if (!whos.has(a.name)) whos.set(a.name, who);
  });
  const whoOf = (id: string): Who => whos.get(id) ?? { key: id, name: id, color: -1 };
  const selected = opts.selectedAuthor !== undefined ? whoOf(opts.selectedAuthor) : undefined;

  const head = h('div', 'rr-ct-head', [h('span', 'rr-ct-range', `${RANGE_TITLE[data.range]} · değişen satırlara göre`)]);

  const main = h('section', 'rr-ct-main', [
    head,
    modulesSection(data.modules, whoOf, selected),
    h('div', 'rr-ct-pair', [rhythmSection(data, selected), expertsSection(data, whoOf, opts.onSelectFile)]),
  ]);
  main.setAttribute('aria-label', 'Katkı paneli');

  el.replaceChildren(h('div', 'rr-ct-layout', [main, authorsAside(data.authors, whoOf, opts)]));
  el.scrollTop = prevScroll;
}

// ---------- modül sahipliği ----------
function modulesSection(modules: readonly ModuleOwnership[], whoOf: (id: string) => Who, selected?: Who): HTMLElement {
  const section = h('section', 'rr-ct-section', [h('h3', 'rr-p-heading', 'MODÜL SAHİPLİĞİ')]);
  if (modules.length === 0) {
    section.append(h('div', 'rr-p-muted', 'Bu aralıkta değişen satır yok.'));
    return section;
  }
  const list = h('div', 'rr-ct-modules');
  for (const m of modules) {
    const label = m.module || '(kök)';
    const total = m.total > 0 ? m.total : m.shares.reduce((s, x) => s + x.lines, 0);
    const pct = (n: number): number => (total > 0 ? Math.round((n / total) * 100) : 0);

    // Renkli yazarlar ayrı segment, kalanlar tek "diğer" segmentinde.
    const segs: Array<{ who: Who; lines: number }> = [];
    let other = 0;
    for (const s of m.shares) {
      const who = whoOf(s.author);
      if (who.color >= 0) segs.push({ who, lines: s.lines });
      else other += s.lines;
    }
    if (other > 0) segs.push({ who: { key: OTHER, name: 'diğer', color: -1 }, lines: other });

    const bar = h('span', 'rr-ct-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute(
      'aria-label',
      `${label}: ${m.shares.map((s) => `${whoOf(s.author).name} %${pct(s.lines)}`).join(', ')}`,
    );
    for (const s of segs) {
      const p = pct(s.lines);
      const seg = h('span', `rr-ct-seg${s.who.color < 0 ? ' is-other' : ''}`, p >= LABEL_MIN_PCT ? `${s.who.name} %${p}` : '');
      seg.style.setProperty('width', `${total > 0 ? (s.lines / total) * 100 : 0}%`);
      if (s.who.color >= 0) {
        seg.style.setProperty('background', authorColor(s.who.color));
        seg.classList.add(`is-c${s.who.color + 1}`);
      }
      if (selected && s.who.key !== selected.key) seg.classList.add('is-dim');
      seg.title = `${s.who.name}: ${formatNumber(s.lines)} satır (%${p})`;
      bar.append(seg);
    }

    const top = m.shares[0];
    const owner = h('span', 'rr-ct-owner');
    if (top) {
      const p = pct(top.lines);
      owner.append(h('span', 'rr-ct-owner-name', `${whoOf(top.author).name} %${p}`));
      if (p >= RISK_PCT) {
        const risk = h('span', 'rr-ct-risk', 'tek kişiye bağlı');
        risk.title = 'Bu modülde değişen satırların %80 ya da fazlası tek kişiden';
        owner.append(risk);
      }
    }
    const name = h('span', 'rr-ct-module', label);
    name.title = label;
    list.append(h('div', 'rr-ct-module-row', [name, bar, owner]));
  }
  section.append(list);
  return section;
}

// ---------- haftalık ritim ----------
function rhythmSection(data: ContribData, selected?: Who): HTMLElement {
  const who = selected ? selected.name : 'Herkes';
  const section = h('section', 'rr-ct-section rr-ct-rhythm', [h('h3', 'rr-p-heading', `HAFTALIK RİTİM · ${who}`)]);
  const weeks = data.weeks;
  if (weeks.length === 0) {
    section.append(h('div', 'rr-p-muted', 'Ritim verisi yok.'));
    return section;
  }
  const grid = (selected ? data.rhythm[selected.key] : data.rhythm['']) ?? [];
  let max = 0;
  for (const w of grid) for (const v of w) max = Math.max(max, v);

  const table = h('div', 'rr-ct-grid');
  table.style.setProperty('grid-template-columns', `34px repeat(${weeks.length}, minmax(0, 1fr))`);
  table.setAttribute('role', 'group');
  table.setAttribute('aria-label', `Haftalık ritim, ${who}`);

  // Çok haftada etiketler seyreltilir.
  const every = Math.max(1, Math.ceil(weeks.length / 6));
  table.append(h('span', ''));
  weeks.forEach((w, i) => table.append(h('span', 'rr-ct-week', i % every === 0 ? shortDate(w) : '')));

  for (let d = 0; d < 7; d++) {
    table.append(h('span', 'rr-ct-day', DAYS[d] ?? ''));
    weeks.forEach((w, i) => {
      const v = grid[i]?.[d] ?? 0;
      const level = v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 4));
      const cell = h('span', `rr-ct-cell rr-ct-l${level}`);
      const label = `${DAYS[d]} ${shortDate(w + d * DAY_MS)}: ${v} commit`;
      cell.setAttribute('role', 'img');
      cell.setAttribute('aria-label', label);
      cell.title = label;
      table.append(cell);
    });
  }

  const legend = h('div', 'rr-ct-legend', [document.createTextNode('Az')]);
  for (let l = 1; l <= 4; l++) {
    const sw = h('span', `rr-ct-swatch rr-ct-l${l}`);
    sw.setAttribute('aria-hidden', 'true');
    legend.append(sw);
  }
  legend.append(document.createTextNode('Çok commit'));
  section.append(table, legend);
  return section;
}

// ---------- dosya uzmanı ----------
function expertsSection(data: ContribData, whoOf: (id: string) => Who, onSelectFile: (path: string) => void): HTMLElement {
  const section = h('section', 'rr-ct-section rr-ct-experts', [h('h3', 'rr-p-heading', 'BU DOSYAYI EN İYİ KİM BİLİR?')]);
  if (data.experts.length === 0) {
    section.append(h('div', 'rr-p-muted', 'Yeterli veri yok.'));
    return section;
  }
  const list = h('ul', 'rr-ct-expert-list');
  for (const e of data.experts) {
    const who = whoOf(e.author);
    const slash = e.path.lastIndexOf('/');
    const file = h('button', 'rr-ct-file', [
      document.createTextNode(baseName(e.path)),
      h('span', 'rr-p-file-dir', slash < 0 ? '' : ` ${e.path.slice(0, slash)}`),
    ]);
    file.type = 'button';
    file.title = `${e.path} — haritada göster`;
    file.addEventListener('click', () => onSelectFile(e.path));

    const dot = h('span', `rr-ct-dot${who.color < 0 ? ' is-other' : ''}`);
    dot.setAttribute('aria-hidden', 'true');
    if (who.color >= 0) dot.style.setProperty('background', authorColor(who.color));

    const p = Math.round(e.share * 100);
    const whoText = `${who.name} · %${p}${p >= RISK_PCT ? ' · tek kişi' : ''}`;
    list.append(h('li', 'rr-ct-expert', [file, dot, h('span', 'rr-ct-expert-who', whoText)]));
  }
  section.append(list);
  return section;
}

// ---------- yazarlar ----------
function authorsAside(authors: readonly AuthorStat[], whoOf: (id: string) => Who, opts: ContributorsOptions): HTMLElement {
  const aside = h('aside', 'rr-ct-authors', [h('h3', 'rr-p-heading', 'YAZARLAR')]);
  aside.setAttribute('aria-label', 'Yazarlar');

  const totalCommits = authors.reduce((s, a) => s + a.commits, 0);
  const everyone = authorButton(
    String(authors.length),
    undefined,
    'Herkes',
    `${formatNumber(totalCommits)} commit · ${formatNumber(authors.length)} yazar`,
    opts.selectedAuthor === undefined,
    () => opts.onSelectAuthor(undefined),
  );
  const list = h('div', 'rr-ct-author-list', [everyone]);
  for (const a of authors) {
    const who = whoOf(a.key);
    const meta = [`${formatNumber(a.commits)} commit`, `+${formatNumber(a.added)} −${formatNumber(a.deleted)}`];
    if (a.topModule !== undefined) meta.push(`en çok ${a.topModule || '(kök)'}`);
    const selected = opts.selectedAuthor === a.key;
    const btn = authorButton(initials(a.name), who.color, a.name, meta.join(' · '), selected, () =>
      opts.onSelectAuthor(selected ? undefined : a.key),
    );
    btn.title = a.email ? `${a.name} <${a.email}>` : a.name;
    list.append(btn);
  }
  aside.append(
    list,
    h('p', 'rr-ct-note', "Yazarlar git'teki isim ve e-postaya göre gruplanır; aynı kişinin farklı e-postaları .mailmap ile birleşir."),
  );
  return aside;
}

function authorButton(
  avatarText: string,
  color: number | undefined,
  name: string,
  meta: string,
  pressed: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const avatar = h('span', `rr-ct-avatar${color === undefined ? ' is-all' : color < 0 ? ' is-other' : ''}`, avatarText);
  avatar.setAttribute('aria-hidden', 'true');
  if (color !== undefined && color >= 0) {
    avatar.style.setProperty('background', authorColor(color));
    avatar.classList.add(`is-c${color + 1}`);
  }
  const btn = h('button', 'rr-ct-author', [
    avatar,
    h('span', 'rr-ct-author-text', [h('span', 'rr-ct-author-name', name), h('span', 'rr-p-meta', meta)]),
  ]);
  btn.type = 'button';
  btn.setAttribute('aria-pressed', String(pressed));
  btn.addEventListener('click', onClick);
  return btn;
}

function authorColor(i: number): string {
  return `var(--vscode-scmGraph-foreground${i + 1})`;
}

function initials(name: string): string {
  const parts = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0]?.[0], parts[parts.length - 1]?.[0]] : [parts[0]?.[0]];
  return chars.join('').toLocaleUpperCase('tr-TR') || '?';
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  content?: string | Node[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (typeof content === 'string') node.textContent = content;
  else if (content) node.append(...content);
  return node;
}
