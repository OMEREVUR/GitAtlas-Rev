// Graph'ın sağındaki seçim ayrıntısı: mini harita, seçilen commit ya da branch, dokunduğu dosyalar.
import type { CommitSummary, GitRef, PullRequest } from '../types';
import type { WebviewToExtension } from '../protocol';
import { prRow } from './githubBanner';
import { baseName, formatDate, formatNumber, formatRelative } from './format';
import { text } from '../i18n/graph';
import { text as bisectText } from '../i18n/bisect';

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
  /**
   * v3: branch adına göre açık PR'lar (PR'ın head branch'i). Remote ref'lerde remote öneki atılmış ad
   * gelir ('origin/feature/x' → 'feature/x').
   */
  prsForBranch?: (name: string) => PullRequest[];
  /** 0.4.0: verilirse commit seçiliyken "İyi / Kötü olarak işaretle" düğmeleri (bisect sürmüyorsa forma yazar). */
  bisect?: { active: boolean; onMark: (hash: string, mark: 'good' | 'bad') => void };
  /**
   * 0.4.0: cherry-pick. count = alınacak commit sayısı (çoklu seçimde >1).
   * disabled: süren bir işlem ya da başka bir git işlemi varken kapalı.
   */
  cherryPick?: { count: number; disabled: boolean; onPick: () => void };
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

  const t = text();
  const host = h('div', 'rr-p-minimap');
  const count = selection
    ? t.filesOf(formatNumber(opts.touchedCount), opts.totalCount, formatNumber(opts.totalCount))
    : t.files(opts.totalCount, formatNumber(opts.totalCount));
  const mapSection = h('section', 'rr-p-detail-map', [
    h('div', 'rr-p-detail-map-head', [h('h3', 'rr-p-heading', t.onMap), h('span', 'rr-p-meta', count)]),
    host,
  ]);

  let body: HTMLElement[];
  if (!selection) {
    body = [
      h('div', 'rr-p-detail-empty', [
        h('div', 'rr-p-card-empty-title', t.emptyTitle),
        h('div', 'rr-p-card-empty-text', t.emptyText),
      ]),
    ];
  } else if (selection.kind === 'commit') {
    body = commitBody(selection.commit, selection.refs, post, opts);
  } else {
    body = branchBody(selection.ref, selection.commits, post, opts);
  }

  el.replaceChildren(h('div', 'rr-p-detail-body', [mapSection, ...body]));
  opts.renderMiniMap(host);
  el.scrollTop = prevScroll;
}

function header(kicker: string, title: string, meta: string, opts: CommitDetailOptions, extra: HTMLElement[] = []): HTMLElement {
  const t = text();
  const close = h('button', 'rr-p-icon-btn', [icon('close')]);
  close.type = 'button';
  close.setAttribute('aria-label', t.clearSelection);
  close.title = t.clearSelection;
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
  const t = text();
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
      ? h('div', 'rr-p-muted', isMerge ? t.mergeNoFiles : t.noFiles)
      : fileList(commit.files, (f) => {
          const diff = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', 'Diff');
          diff.type = 'button';
          diff.setAttribute('aria-label', t.viewDiff(baseName(f.path)));
          diff.addEventListener('click', () => post({ type: 'openDiff', path: f.path, hash: commit.hash }));
          return diff;
        });

  const show = primaryButton(t.showInMap, opts.onShowInMap);
  const copy = h('button', 'rr-p-btn rr-p-btn-secondary', t.copyHash);
  copy.type = 'button';
  let resetTimer: number | undefined;
  copy.addEventListener('click', () => {
    const done = (label: string): void => {
      copy.textContent = label;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => (copy.textContent = t.copyHash), COPIED_MS);
    };
    const clip = navigator.clipboard as Clipboard | undefined;
    if (!clip) {
      done(t.copyFailed);
      return;
    }
    clip.writeText(commit.hash).then(
      () => done(t.copied),
      () => done(t.copyFailed),
    );
  });
  copy.setAttribute('aria-live', 'polite');

  const prs = prsForRefs(refs, opts);
  const out = [head, ...prList(prs, post), filesSection(files), h('div', 'rr-p-actions', [show, copy])];
  if (opts.cherryPick) out.push(cherryPickSection(opts.cherryPick));
  if (opts.bisect) out.push(bisectSection(commit.hash, opts.bisect));
  return out;
}

function cherryPickSection(cp: NonNullable<CommitDetailOptions['cherryPick']>): HTMLElement {
  const t = text();
  const btn = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', t.pickButton(cp.count));
  btn.type = 'button';
  btn.disabled = cp.disabled;
  btn.title = t.pickTitle;
  btn.addEventListener('click', cp.onPick);
  return h('section', 'rr-p-section rr-p-pick', [
    h('h3', 'rr-p-heading', t.pickTitleHeading),
    h('div', 'rr-p-actions', [btn]),
    h('div', 'rr-p-muted', cp.count > 1 ? t.pickHintMany(cp.count) : t.pickHintOne),
  ]);
}

function bisectSection(hash: string, b: NonNullable<CommitDetailOptions['bisect']>): HTMLElement {
  const t = bisectText();
  const mk = (label: string, mark: 'good' | 'bad'): HTMLButtonElement => {
    const btn = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', label);
    btn.type = 'button';
    btn.addEventListener('click', () => b.onMark(hash, mark));
    return btn;
  };
  return h('section', 'rr-p-section rr-p-bisect', [
    h('h3', 'rr-p-heading', t.detailTitle),
    h('div', 'rr-p-actions', [mk(t.detailGood, 'good'), mk(t.detailBad, 'bad')]),
    h('div', 'rr-p-muted', b.active ? t.detailHintActive : t.detailHintIdle),
  ]);
}

function branchBody(
  ref: GitRef,
  commits: readonly CommitSummary[],
  post: (msg: WebviewToExtension) => void,
  opts: CommitDetailOptions,
): HTMLElement[] {
  const t = text();
  const kind = ref.kind === 'local' ? t.kickerLocal : ref.kind === 'remote' ? t.kickerRemote : t.kickerTag;
  const kicker = `${kind}${ref.isHead ? ' · HEAD' : ''}`;

  const meta: string[] = [];
  if (ref.ahead !== undefined || ref.behind !== undefined) {
    meta.push(`↑${ref.ahead ?? 0} ↓${ref.behind ?? 0}${ref.compareTo ? ` ${ref.compareTo}` : ''}`);
  }
  if (ref.date > 0) meta.push(t.lastCommit(formatRelative(ref.date, opts.now)));
  if (ref.author) meta.push(ref.author);

  const extra: HTMLElement[] = [];
  if (ref.date > 0 && opts.now - ref.date > STALE_MS) {
    const stale = h('span', 'rr-p-tag', t.stale);
    stale.title = t.staleTitle;
    extra.push(h('div', 'rr-p-reftags', [stale]));
  }
  const head = header(kicker, ref.name, meta.join(' · '), opts, extra);

  const rows = aggregateFiles(commits);
  const files = rows.length === 0 ? h('div', 'rr-p-muted', t.branchNoOwn) : fileList(rows);

  return [
    head,
    ...prList(prsForRefs([ref], opts), post),
    h('div', 'rr-p-detail-count', t.commits(commits.length, formatNumber(commits.length))),
    filesSection(files),
    h('div', 'rr-p-actions', [primaryButton(t.showInMap, opts.onShowInMap)]),
  ];
}

/** Ref'lerin (lokal/remote branch) PR'ları, numaraya göre tekilleştirilmiş. Etiketler atlanır. */
function prsForRefs(refs: readonly GitRef[], opts: CommitDetailOptions): PullRequest[] {
  const lookup = opts.prsForBranch;
  if (!lookup) return [];
  const seen = new Map<number, PullRequest>();
  for (const r of refs) {
    if (r.kind === 'tag') continue;
    const name = r.kind === 'remote' ? r.name.slice(r.name.indexOf('/') + 1) : r.name;
    for (const pr of lookup(name)) if (!seen.has(pr.number)) seen.set(pr.number, pr);
  }
  return [...seen.values()];
}

function prList(prs: readonly PullRequest[], post: (msg: WebviewToExtension) => void): HTMLElement[] {
  if (prs.length === 0) return [];
  return [h('ul', 'rr-p-prs', prs.map((pr) => h('li', '', [prRow(pr, post)])))];
}

function filesSection(content: HTMLElement): HTMLElement {
  return h('section', 'rr-p-section', [h('h3', 'rr-p-heading', text().touchedFiles), content]);
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
    const more = rows.length - FILE_LIMIT;
    list.append(h('li', 'rr-p-muted rr-p-file-more', text().moreFiles(more, formatNumber(more))));
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
