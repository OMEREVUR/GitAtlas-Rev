// Son commit'ler akışı: en yeni 50 commit; seçilen commit'in dosyaları haritada yanar.
import type { CommitSummary } from '../types';
import { formatDate, formatRelative } from './format';
import { text } from '../i18n/map';

export interface CommitFeedOptions {
  selectedHash?: string;
  now: number;
  onSelectCommit: (hash: string | undefined) => void;
}

const FEED_LIMIT = 50;

export function renderCommitFeed(el: HTMLElement, commits: CommitSummary[], opts: CommitFeedOptions): void {
  el.classList.add('rr-p-feed');

  // Yeniden render'da kaydırma konumu ve odak korunur.
  const prevList = el.querySelector<HTMLElement>('.rr-p-feed-list');
  const prevScroll = prevList?.scrollTop ?? 0;
  const active = document.activeElement;
  const focusedHash = active instanceof HTMLElement && el.contains(active) ? active.dataset.hash : undefined;

  const t = text();
  const heading = h('h3', 'rr-p-heading rr-p-feed-heading', t.recentCommits);

  if (commits.length === 0) {
    el.replaceChildren(heading, h('div', 'rr-p-feed-empty rr-p-muted', t.noCommitsYet));
    return;
  }

  const list = h('ul', 'rr-p-feed-list');
  list.setAttribute('aria-label', t.recentCommitsAria);
  let toFocus: HTMLButtonElement | undefined;
  for (const c of commits.slice(0, FEED_LIMIT)) {
    const selected = c.hash === opts.selectedHash;
    const btn = h('button', 'rr-p-feed-row');
    btn.type = 'button';
    btn.dataset.hash = c.hash;
    btn.setAttribute('aria-pressed', String(selected));
    btn.title = `${c.message}\n${c.author} · ${formatDate(c.date)}`;

    const top = h('span', 'rr-p-feed-top', [h('code', 'rr-p-hash', c.shortHash), h('span', 'rr-p-msg', c.message)]);
    if (c.parents.length > 1) top.append(h('span', 'rr-p-tag', 'merge'));
    const fileCount = c.files.length;
    const meta = h('span', 'rr-p-meta', `${c.author} · ${formatRelative(c.date, opts.now)} · ${t.files(fileCount)}`);
    btn.append(top, meta);

    btn.addEventListener('click', () => opts.onSelectCommit(selected ? undefined : c.hash));
    if (c.hash === focusedHash) toFocus = btn;
    list.append(h('li', 'rr-p-feed-item', [btn]));
  }

  el.replaceChildren(heading, list);
  list.scrollTop = prevScroll;
  toFocus?.focus({ preventScroll: true });
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
