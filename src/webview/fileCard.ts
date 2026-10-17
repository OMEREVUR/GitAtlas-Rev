// Dosya kartı: seçili dosyanın özeti, son 5 commit'i (yeniden adlandırmayı takip ederek) ve eylemleri.
import type { CommitSummary, FileStat, PullRequest, TimeRange } from '../types';
import type { WebviewToExtension } from '../protocol';
import { heatLabel, heatVar, type HeatLevel } from './heat';
import { prRow } from './githubBanner';
import { baseName, formatDate, formatNumber, formatRelative, rangeShort } from './format';
import { text } from '../i18n/map';

export interface FileCardOptions {
  range: TimeRange;
  heat: HeatLevel;
  now: number;
  onClose: () => void;
  /** v3: bu dosyaya dokunan açık PR'lar. */
  prs?: PullRequest[];
  /** v3: GitHub verisi eski (oturum düştü, ağ yok, limit bitti). */
  prStale?: boolean;
}

const RECENT_LIMIT = 5;
const AUTHOR_LIMIT = 3;

/** Bu dosyaya dokunan en son commit'ler; her biri o commit'teki yoluyla. */
export function recentCommitsForFile(
  path: string,
  commits: readonly CommitSummary[],
  limit = RECENT_LIMIT,
): Array<{ commit: CommitSummary; path: string }> {
  const result: Array<{ commit: CommitSummary; path: string }> = [];
  let name = path;
  for (const commit of commits) {
    const change = commit.files.find((f) => f.path === name);
    if (!change) continue;
    result.push({ commit, path: name });
    if (result.length >= limit) break;
    if (change.oldPath) name = change.oldPath;
  }
  return result;
}

export function renderFileCard(
  el: HTMLElement,
  file: FileStat | undefined,
  commits: CommitSummary[],
  post: (msg: WebviewToExtension) => void,
  opts: FileCardOptions,
): void {
  el.classList.add('rr-p-card');
  const t = text();
  if (!file) {
    el.replaceChildren(
      h('div', 'rr-p-card-empty', [
        icon('file', 'rr-p-card-empty-icon'),
        h('div', 'rr-p-card-empty-title', t.pickFile),
        h('div', 'rr-p-card-empty-text', t.pickFileText),
      ]),
    );
    return;
  }

  const range = rangeShort(opts.range);

  const close = h('button', 'rr-p-icon-btn', [icon('close')]);
  close.type = 'button';
  close.setAttribute('aria-label', t.closeCard);
  close.title = t.closeCard;
  close.addEventListener('click', () => opts.onClose());

  const pathEl = h('div', 'rr-p-card-path', file.path);
  const head = h('div', 'rr-p-card-head', [
    h('div', 'rr-p-card-titles', [h('h2', 'rr-p-card-name', baseName(file.path)), pathEl]),
    close,
  ]);

  const stats = h('div', 'rr-p-stats', [
    stat(t.tipLines, formatNumber(file.lines)),
    stat(t.statCommits(range), formatNumber(file.changes)),
  ]);

  const meter = h('div', 'rr-p-meter');
  meter.setAttribute('aria-hidden', 'true');
  for (let n = 1; n <= 5; n++) {
    const seg = h('span', 'rr-p-meter-seg');
    if (n <= opts.heat) {
      seg.classList.add('is-on');
      seg.style.setProperty('background', heatVar(n as HeatLevel));
    }
    meter.append(seg);
  }
  const heat = h('div', 'rr-p-heat', [
    h('div', 'rr-p-heat-head', [h('span', '', t.changeFrequency), h('span', 'rr-p-heat-label', heatLabel(opts.heat))]),
    meter,
  ]);

  const authors =
    file.authors.length === 0
      ? '—'
      : file.authors.slice(0, AUTHOR_LIMIT).join(', ') +
        (file.authors.length > AUTHOR_LIMIT ? ` +${file.authors.length - AUTHOR_LIMIT}` : '');
  const authorsEl = h('dd', 'rr-p-fact-value', authors);
  if (file.authors.length > AUTHOR_LIMIT) authorsEl.title = file.authors.join(', ');

  const touched = h('dd', 'rr-p-fact-value', formatRelative(file.lastModified, opts.now));
  if (file.lastModified > 0) touched.title = formatDate(file.lastModified);

  const facts = h('dl', 'rr-p-facts', [
    h('dt', 'rr-p-fact-label', t.addedDeleted(range)),
    h('dd', 'rr-p-fact-value', [
      h('span', 'rr-p-add', `+${formatNumber(file.added)}`),
      h('span', 'rr-p-del', `−${formatNumber(file.deleted)}`),
    ]),
    h('dt', 'rr-p-fact-label', t.authorsRange(range)),
    authorsEl,
    h('dt', 'rr-p-fact-label', t.lastTouched),
    touched,
  ]);

  const recent = recentCommitsForFile(file.path, commits);
  const recentList: HTMLElement =
    recent.length === 0
      ? h('div', 'rr-p-muted', t.noCommitsForFile)
      : h(
          'ul',
          'rr-p-recent',
          recent.map(({ commit, path }) => recentRow(commit, path, file.path, post, opts.now)),
        );
  const recentSection = h('section', 'rr-p-section', [h('h3', 'rr-p-heading', t.recentCommits), recentList]);

  const open = h('button', 'rr-p-btn rr-p-btn-primary', t.openFile);
  open.type = 'button';
  open.addEventListener('click', () => post({ type: 'openFile', path: file.path }));

  el.replaceChildren(
    h('div', 'rr-p-card-body', [
      head,
      stats,
      heat,
      ...prSections(opts.prs ?? [], opts.prStale === true, post),
      facts,
      recentSection,
      h('div', 'rr-p-actions', [open]),
    ]),
  );
}

/** v3: 2+ PR'da çakışma notu ve "AÇIK PR'LAR" listesi. PR yoksa hiçbir şey eklemez. */
function prSections(prs: readonly PullRequest[], stale: boolean, post: (msg: WebviewToExtension) => void): HTMLElement[] {
  if (prs.length === 0) return [];
  const t = text();
  const out: HTMLElement[] = [];
  if (prs.length >= 2) {
    const warn = h('span', `codicon codicon-warning rr-p-conflict-icon`);
    warn.setAttribute('aria-hidden', 'true');
    const note = h('div', `rr-p-conflict${stale ? ' is-stale' : ''}`, [
      warn,
      h('span', '', [
        document.createTextNode(t.prConflictPre),
        h('strong', '', t.openPrs(prs.length)),
        document.createTextNode(t.prConflictPost + (stale ? ` (${t.staleData})` : '')),
      ]),
    ]);
    note.setAttribute('role', 'note');
    out.push(note);
  }
  const heading = h('h3', 'rr-p-heading', t.openPrsHeading);
  if (stale) heading.append(h('span', 'rr-p-heading-note', ` · ${t.staleData}`));
  const list = h('ul', 'rr-p-prs', prs.map((pr) => h('li', '', [prRow(pr, post)])));
  out.push(h('section', 'rr-p-section', [heading, list]));
  return out;
}

function stat(label: string, value: string): HTMLElement {
  return h('div', 'rr-p-stat', [h('div', 'rr-p-stat-label', label), h('div', 'rr-p-stat-value', value)]);
}

function recentRow(
  commit: CommitSummary,
  path: string,
  currentPath: string,
  post: (msg: WebviewToExtension) => void,
  now: number,
): HTMLElement {
  const t = text();
  const meta = h('span', 'rr-p-meta', `${commit.author} · ${formatRelative(commit.date, now)}`);
  if (path !== currentPath) meta.append(h('span', 'rr-p-oldname', t.oldName(baseName(path))));
  meta.title = formatDate(commit.date);

  const msg = h('span', 'rr-p-msg', commit.message);
  msg.title = commit.message;

  const diff = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', 'Diff');
  diff.type = 'button';
  diff.setAttribute('aria-label', t.diffAria(commit.shortHash));
  diff.addEventListener('click', () => post({ type: 'openDiff', path, hash: commit.hash }));

  return h('li', 'rr-p-recent-row', [
    h('code', 'rr-p-hash', commit.shortHash),
    h('span', 'rr-p-recent-text', [msg, meta]),
    diff,
  ]);
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

function icon(name: string, extra = ''): HTMLElement {
  const span = h('span', `codicon codicon-${name}${extra ? ` ${extra}` : ''}`);
  span.setAttribute('aria-hidden', 'true');
  return span;
}
