// Graph'ın sağındaki seçim ayrıntısı: mini harita, seçilen commit ya da branch, dokunduğu dosyalar.
import type { CommitSummary, GitRef } from '../types';
import type { WebviewToExtension } from '../protocol';
import { baseName, formatDate, formatNumber, formatRelative } from './format';

export type GraphSelection =
  | { kind: 'commit'; commit: CommitSummary; refs: GitRef[] }
  | { kind: 'branch'; ref: GitRef; commits: CommitSummary[] };

export interface CommitDetailOptions {
  now: number;
  /** Seçimin dokunduğu ve haritada bulunan dosya sayısı. */
  touchedCount: number;
  /** Haritadaki toplam dosya. */
  totalCount: number;
  renderMiniMap: (host: HTMLElement) => void;
  onShowInMap: () => void;
  onClear: () => void;
}

const STALE_MS = 30 * 24 * 3600_000;
/** Çok büyük branch'lerde DOM'u şişirmemek için gösterilen en fazla dosya satırı. */
const FILE_LIMIT = 200;
const COPIED_MS = 1500;

interface FileRow {
  path: string;
  added: number;
  deleted: number;
}

/** Branch'in commit'lerindeki dosyaları birleştirir: aynı yol tek satır, +/− toplanır, en çok değişenden aza. */
export function aggregateFiles(commits: readonly CommitSummary[]): FileRow[] {
  const map = new Map<string, FileRow>();
  for (const c of commits) {
    for (const f of c.files) {
      const row = map.get(f.path);
      if (row) {
        row.added += f.added;
        row.deleted += f.deleted;
      } else {
        map.set(f.path, { path: f.path, added: f.added, deleted: f.deleted });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.added + b.deleted - (a.added + a.deleted) || a.path.localeCompare(b.path));
}

export function renderCommitDetail(
  el: HTMLElement,
  selection: GraphSelection | undefined,
  post: (msg: WebviewToExtension) => void,
  opts: CommitDetailOptions,
): void {
  el.classList.add('rr-p-detail');

  // Aynı seçim yeniden çizilirken kaydırma konumu korunur.
  const key = selection ? (selection.kind === 'commit' ? `c:${selection.commit.hash}` : `b:${selection.ref.fullName}`) : '';
  const prevScroll = el.dataset.selKey === key ? el.scrollTop : 0;
  el.dataset.selKey = key;

  const host = h('div', 'rr-p-minimap');
  const count = selection
    ? `${formatNumber(opts.touchedCount)} / ${formatNumber(opts.totalCount)} dosya`
    : `${formatNumber(opts.totalCount)} dosya`;
  const mapSection = h('section', 'rr-p-detail-map', [
    h('div', 'rr-p-detail-map-head', [h('h3', 'rr-p-heading', 'HARİTADA'), h('span', 'rr-p-meta', count)]),
    host,
  ]);

  let body: HTMLElement[];
  if (!selection) {
    body = [
      h('div', 'rr-p-detail-empty', [
        h('div', 'rr-p-card-empty-title', 'Bir commit ya da branch seç'),
        h(
          'div',
          'rr-p-card-empty-text',
          "Graph'ta bir satıra ya da Branch'ler panelinde bir branch'e tıkla; dokunduğu dosyalar haritada yanar.",
        ),
      ]),
    ];
  } else if (selection.kind === 'commit') {
    body = commitBody(selection.commit, selection.refs, post, opts);
  } else {
    body = branchBody(selection.ref, selection.commits, opts);
  }

  el.replaceChildren(h('div', 'rr-p-detail-body', [mapSection, ...body]));
  opts.renderMiniMap(host);
  el.scrollTop = prevScroll;
}

function header(kicker: string, title: string, meta: string, opts: CommitDetailOptions, extra: HTMLElement[] = []): HTMLElement {
  const close = h('button', 'rr-p-icon-btn', [icon('close')]);
  close.type = 'button';
  close.setAttribute('aria-label', 'Seçimi kaldır');
  close.title = 'Seçimi kaldır';
  close.addEventListener('click', () => opts.onClear());

  const titleEl = h('h2', 'rr-p-detail-title', title);
  const children: HTMLElement[] = [h('div', 'rr-p-detail-kicker', kicker), titleEl];
  if (meta) children.push(h('div', 'rr-p-detail-meta', meta));
  children.push(...extra);
  return h('div', 'rr-p-card-head', [h('div', 'rr-p-card-titles rr-p-detail-titles', children), close]);
}

function commitBody(
  commit: CommitSummary,
  refs: readonly GitRef[],
  post: (msg: WebviewToExtension) => void,
  opts: CommitDetailOptions,
): HTMLElement[] {
  const isMerge = commit.parents.length > 1;
  const extra: HTMLElement[] = [];
  if (refs.length > 0) extra.push(h('div', 'rr-p-reftags', refs.map(refTag)));
  const head = header(
    isMerge ? 'MERGE COMMIT' : 'COMMIT',
    commit.message,
    `${commit.author} · ${formatRelative(commit.date, opts.now)} · ${commit.shortHash}`,
    opts,
    extra,
  );
  head.querySelector('.rr-p-detail-meta')?.setAttribute('title', formatDate(commit.date));

  const files =
    commit.files.length === 0
      ? h('div', 'rr-p-muted', isMerge ? "Merge commit'i: değişiklikler parent'larda görünür." : 'Bu commit dosya değiştirmiyor.')
      : fileList(commit.files, (f) => {
          const diff = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', 'Diff');
          diff.type = 'button';
          diff.setAttribute('aria-label', `${baseName(f.path)} diff'ini gör`);
          diff.addEventListener('click', () => post({ type: 'openDiff', path: f.path, hash: commit.hash }));
          return diff;
        });

  const show = primaryButton('Haritada aç', opts.onShowInMap);
  const copy = h('button', 'rr-p-btn rr-p-btn-secondary', "Hash'i kopyala");
  copy.type = 'button';
  let resetTimer: number | undefined;
  copy.addEventListener('click', () => {
    const done = (text: string): void => {
      copy.textContent = text;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => (copy.textContent = "Hash'i kopyala"), COPIED_MS);
    };
    const clip = navigator.clipboard as Clipboard | undefined;
    if (!clip) {
      done('Kopyalanamadı');
      return;
    }
    clip.writeText(commit.hash).then(
      () => done('Kopyalandı'),
      () => done('Kopyalanamadı'),
    );
  });
  copy.setAttribute('aria-live', 'polite');

  return [head, filesSection(files), h('div', 'rr-p-actions', [show, copy])];
}

function branchBody(ref: GitRef, commits: readonly CommitSummary[], opts: CommitDetailOptions): HTMLElement[] {
  const kind = ref.kind === 'local' ? 'BRANCH · LOKAL' : ref.kind === 'remote' ? 'BRANCH · REMOTE' : 'ETİKET';
  const kicker = `${kind}${ref.isHead ? ' · HEAD' : ''}`;

  const meta: string[] = [];
  if (ref.ahead !== undefined || ref.behind !== undefined) {
    meta.push(`↑${ref.ahead ?? 0} ↓${ref.behind ?? 0}${ref.compareTo ? ` ${ref.compareTo}` : ''}`);
  }
  if (ref.date > 0) meta.push(`son: ${formatRelative(ref.date, opts.now)}`);
  if (ref.author) meta.push(ref.author);

  const extra: HTMLElement[] = [];
  if (ref.date > 0 && opts.now - ref.date > STALE_MS) {
    const stale = h('span', 'rr-p-tag', 'bayat');
    stale.title = '30 günden uzun süredir commit yok';
    extra.push(h('div', 'rr-p-reftags', [stale]));
  }
  const head = header(kicker, ref.name, meta.join(' · '), opts, extra);

  const rows = aggregateFiles(commits);
  const files = rows.length === 0 ? h('div', 'rr-p-muted', "Bu branch'in kendi commit'i yok.") : fileList(rows);

  return [
    head,
    h('div', 'rr-p-detail-count', `${formatNumber(commits.length)} commit`),
    filesSection(files),
    h('div', 'rr-p-actions', [primaryButton('Haritada aç', opts.onShowInMap)]),
  ];
}

function filesSection(content: HTMLElement): HTMLElement {
  return h('section', 'rr-p-section', [h('h3', 'rr-p-heading', 'DOKUNDUĞU DOSYALAR'), content]);
}

function fileList(rows: readonly FileRow[], trailing?: (f: FileRow) => HTMLElement): HTMLElement {
  const list = h(
    'ul',
    'rr-p-files',
    rows.slice(0, FILE_LIMIT).map((f) => {
      const slash = f.path.lastIndexOf('/');
      const name = h('span', 'rr-p-file-name', [
        document.createTextNode(baseName(f.path)),
        h('span', 'rr-p-file-dir', slash < 0 ? '' : ` ${f.path.slice(0, slash)}`),
      ]);
      name.title = f.path;
      const li = h('li', 'rr-p-file-row', [
        name,
        h('span', 'rr-p-add', `+${formatNumber(f.added)}`),
        h('span', 'rr-p-del', `−${formatNumber(f.deleted)}`),
      ]);
      if (trailing) li.append(trailing(f));
      return li;
    }),
  );
  if (rows.length > FILE_LIMIT) {
    list.append(h('li', 'rr-p-muted rr-p-file-more', `+${formatNumber(rows.length - FILE_LIMIT)} dosya daha`));
  }
  return list;
}

function refTag(ref: GitRef): HTMLElement {
  const name = ref.kind === 'tag' ? 'tag' : ref.kind === 'remote' ? 'cloud' : 'git-branch';
  const tag = h('span', `rr-p-reftag${ref.isHead ? ' is-head' : ''}`, [icon(name), document.createTextNode(ref.name)]);
  if (ref.isHead) tag.append(h('span', 'rr-p-reftag-head', 'HEAD'));
  return tag;
}

function primaryButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = h('button', 'rr-p-btn rr-p-btn-primary', label);
  btn.type = 'button';
  btn.addEventListener('click', () => onClick());
  return btn;
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

function icon(name: string): HTMLElement {
  const span = h('span', `codicon codicon-${name}`);
  span.setAttribute('aria-hidden', 'true');
  return span;
}
