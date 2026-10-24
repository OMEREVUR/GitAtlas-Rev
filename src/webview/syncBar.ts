// Her sekmede görünen eşitleme çubuğu: branch, ↑↓ ve Getir / Çek / Gönder düğmeleri.
// DOM bir kez kurulur; sonraki çağrılar yalnızca değerleri günceller (düğme odağı korunur).
import './ops.css';
import type { GitOpKind, GitOpRequest, WorkingTreeStatus } from '../types';
import { formatCommand, opCommands } from '../git/opCommands';
import { getLang, type Lang } from '../i18n/index';
import { text } from '../i18n/changes';

export interface SyncBarOptions {
  status: WorkingTreeStatus | undefined;
  busy: boolean;
  busyKind?: GitOpKind;
  onOp: (op: GitOpRequest) => void;
  /** Verilirse branch adı bir düğme olur: branch'e geç / yeni branch oluştur menüsü (QuickPick eklentide). */
  onBranchMenu?: () => void;
  /** Verilirse branch adının yanında "Yeni branch" ikon düğmesi çıkar. */
  onBranchCreate?: () => void;
  /** 0.3.0: workspace'te 2+ repo varsa gösterilen repo; onRepoMenu ile birlikte verilirse branch'in solunda repo düğmesi çıkar. */
  repo?: { name: string; count: number };
  onRepoMenu?: () => void;
}

interface SyncButton {
  btn: HTMLButtonElement;
  icon: HTMLElement;
  label: HTMLElement;
  baseIcon: string;
}

interface BarState {
  opts: SyncBarOptions;
  /** İskeletin kurulduğu dil; değişirse yeniden kurulur. */
  lang: Lang;
  branch: HTMLElement;
  repoBtn: HTMLButtonElement;
  repoLabel: HTMLElement;
  refStatic: HTMLElement;
  refBtn: HTMLButtonElement;
  refBtnLabel: HTMLElement;
  create: HTMLButtonElement;
  counts: HTMLElement;
  fetch: SyncButton;
  pull: SyncButton;
  push: SyncButton;
}

const states = new WeakMap<HTMLElement, BarState>();

export function renderSyncBar(el: HTMLElement, opts: SyncBarOptions): void {
  let st = states.get(el);
  if (!st || !el.contains(st.refBtn) || st.lang !== getLang()) st = build(el, opts);
  st.opts = opts;
  const { status, busy, busyKind } = opts;
  const t = text();

  // Branch
  if (!status) {
    st.branch.textContent = t.sbLoading;
    st.branch.title = '';
  } else if (status.branch) {
    st.branch.textContent = status.branch;
    st.branch.title = status.upstream ? `${status.branch} → ${status.upstream}` : status.branch;
  } else {
    st.branch.textContent = `${t.sbDetached}${status.head ? ` · ${status.head.slice(0, 7)}` : ''}`;
    st.branch.title = t.sbDetachedTitle;
  }

  // Repo seçici (yalnızca 2+ repo)
  const repo = opts.onRepoMenu ? opts.repo : undefined;
  st.repoBtn.hidden = !repo;
  if (repo) {
    st.repoLabel.textContent = repo.name;
    st.repoBtn.setAttribute('aria-label', t.sbRepoAria(repo.name));
    st.repoBtn.title = `${repo.name}\n${t.sbRepoMenu(repo.count)}`;
    st.repoBtn.disabled = busy;
  }

  // Branch menüsü / yeni branch düğmeleri (verilmezse eski düz görünüm)
  st.refBtnLabel.textContent = st.branch.textContent;
  st.refBtn.hidden = !opts.onBranchMenu;
  st.refStatic.hidden = !!opts.onBranchMenu;
  st.refBtn.disabled = busy || !status;
  st.refBtn.setAttribute('aria-label', t.sbBranchAria(st.branch.textContent ?? ''));
  st.refBtn.title = st.branch.title ? `${t.sbBranchMenu}\n${st.branch.title}` : t.sbBranchMenu;
  st.create.hidden = !opts.onBranchCreate;
  st.create.disabled = busy || !status;

  // ↑↓
  st.counts.className = 'rr-op-sync-counts';
  if (!status) {
    st.counts.textContent = '';
    st.counts.removeAttribute('aria-label');
  } else if (status.upstream) {
    st.counts.textContent = `↑${status.ahead} ↓${status.behind}`;
    st.counts.setAttribute('aria-label', t.sbAheadBehindAria(status.ahead, status.behind));
    st.counts.title = t.sbCompare(status.upstream);
  } else if (status.branch) {
    st.counts.textContent = t.sbUnpublished;
    st.counts.classList.add('is-tag');
    st.counts.removeAttribute('aria-label');
    st.counts.title = t.sbNoUpstreamTitle;
  } else {
    st.counts.textContent = '';
    st.counts.removeAttribute('aria-label');
  }

  const hasUpstream = !!status?.upstream;
  const detached = !!status && !status.branch;

  configure(st.fetch, {
    label: t.sbFetch,
    aria: t.sbFetchAria,
    op: { kind: 'fetch' },
    status,
    disabled: !status || busy,
    spinning: busy && busyKind === 'fetch',
    accent: false,
  });
  configure(st.pull, {
    label: t.sbPull,
    aria: status?.behind ? t.sbPullCountAria(status.behind) : t.sbPullAria,
    op: { kind: 'pull' },
    status,
    disabled: !status || busy || !hasUpstream,
    why: status && !hasUpstream ? t.sbPullNoUpstream : undefined,
    spinning: busy && busyKind === 'pull',
    accent: (status?.behind ?? 0) > 0,
  });
  configure(st.push, {
    label: hasUpstream || !status ? t.sbPush : t.sbPublish,
    aria: hasUpstream
      ? status?.ahead
        ? t.sbPushCountAria(status.ahead)
        : t.sbPushAria
      : t.sbPublishAria,
    op: { kind: 'push' },
    status,
    disabled: !status || busy || detached,
    why: detached ? t.sbDetachedPushWhy : undefined,
    spinning: busy && busyKind === 'push',
    accent: (status?.ahead ?? 0) > 0 || (!!status?.branch && !hasUpstream),
    iconOverride: hasUpstream || !status ? undefined : 'cloud-upload',
  });
}

function build(el: HTMLElement, opts: SyncBarOptions): BarState {
  el.classList.add('rr-op-sync');
  const t = text();
  const branch = h('span', 'rr-op-sync-branch');
  const repoLabel = h('span', 'rr-op-sync-branch');
  const repoBtn = h('button', 'rr-op-sync-ref rr-op-sync-ref-btn rr-op-sync-repo', [icon('repo'), repoLabel, icon('chevron-down', 'rr-op-sync-caret')]);
  repoBtn.type = 'button';
  repoBtn.setAttribute('aria-haspopup', 'menu');
  repoBtn.hidden = true;
  const refStatic = h('span', 'rr-op-sync-ref', [icon('git-branch'), branch]);
  const refBtnLabel = h('span', 'rr-op-sync-branch');
  const refBtn = h('button', 'rr-op-sync-ref rr-op-sync-ref-btn', [icon('git-branch'), refBtnLabel, icon('chevron-down', 'rr-op-sync-caret')]);
  refBtn.type = 'button';
  refBtn.setAttribute('aria-haspopup', 'menu');
  const create = h('button', 'rr-op-sync-icon', [icon('add')]);
  create.type = 'button';
  create.setAttribute('aria-label', t.sbNewBranch);
  create.title = t.sbNewBranchTitle;
  const counts = h('span', 'rr-op-sync-counts');
  const fetch = makeButton('cloud-download');
  const pull = makeButton('arrow-down');
  const push = makeButton('arrow-up');
  const row = h('div', 'rr-op-sync-row', [
    h('span', 'rr-op-sync-refs', [repoBtn, refStatic, refBtn, create]),
    counts,
    h('span', 'rr-op-sync-buttons', [fetch.btn, pull.btn, push.btn]),
  ]);
  row.setAttribute('role', 'toolbar');
  row.setAttribute('aria-label', t.sbToolbar);
  el.replaceChildren(row);

  const st: BarState = { opts, lang: getLang(), branch, repoBtn, repoLabel, refStatic, refBtn, refBtnLabel, create, counts, fetch, pull, push };
  repoBtn.addEventListener('click', () => st.opts.onRepoMenu?.());
  refBtn.addEventListener('click', () => st.opts.onBranchMenu?.());
  create.addEventListener('click', () => st.opts.onBranchCreate?.());
  states.set(el, st);
  fetch.btn.addEventListener('click', () => st.opts.onOp({ kind: 'fetch' }));
  pull.btn.addEventListener('click', () => st.opts.onOp({ kind: 'pull' }));
  push.btn.addEventListener('click', () => st.opts.onOp({ kind: 'push' }));
  return st;
}

function makeButton(baseIcon: string): SyncButton {
  const ic = icon(baseIcon);
  const label = h('span', 'rr-op-sync-label');
  const btn = h('button', 'rr-op-sync-btn', [ic, label]);
  btn.type = 'button';
  return { btn, icon: ic, label, baseIcon };
}

function configure(
  b: SyncButton,
  c: {
    label: string;
    aria: string;
    op: GitOpRequest;
    status: WorkingTreeStatus | undefined;
    disabled: boolean;
    why?: string;
    spinning: boolean;
    accent: boolean;
    iconOverride?: string;
  },
): void {
  b.label.textContent = c.label;
  b.btn.setAttribute('aria-label', c.aria);
  b.btn.disabled = c.disabled;
  b.btn.classList.toggle('is-accent', c.accent);
  b.btn.setAttribute('aria-busy', String(c.spinning));
  const name = c.spinning ? 'loading codicon-modifier-spin' : (c.iconOverride ?? b.baseIcon);
  b.icon.className = `codicon codicon-${name}`;
  let cmds = '';
  if (c.status) {
    try {
      cmds = opCommands(c.op, c.status).map(formatCommand).join('\n');
    } catch {
      cmds = '';
    }
  }
  b.btn.title = [c.aria, c.why, cmds].filter(Boolean).join('\n');
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
