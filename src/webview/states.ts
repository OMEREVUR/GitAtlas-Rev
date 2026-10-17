// Durum ekranları (tasarım: States.dc.html): ilk tarama ve hata durumları.
import type { ErrorCode, StateAction, WebviewToExtension } from '../protocol';
import { text } from '../i18n/map';

export type PanelState = { kind: 'loading'; progress: number } | { kind: 'error'; code: ErrorCode; message: string };

/** Metin parçası ya da `kod` olarak gösterilecek parça. */
type Rich = Array<string | { code: string }>;

interface ActionSpec {
  label: string;
  primary: boolean;
  msg: WebviewToExtension;
}

interface ErrorSpec {
  icon: string;
  danger?: boolean;
  title: string;
  text: Rich;
  actions: ActionSpec[];
}

const cmd = (action: StateAction): WebviewToExtension => ({ type: 'command', action });

function errorSpec(code: ErrorCode, message: string): ErrorSpec {
  const t = text();
  switch (code) {
    case 'noRepo':
      return {
        icon: 'folder',
        title: t.noRepoTitle,
        text: [t.noRepoText1, { code: '.git' }, t.noRepoText2],
        actions: [
          { label: t.initRepo, primary: true, msg: cmd('initRepo') },
          { label: t.openOtherFolder, primary: false, msg: cmd('openFolder') },
        ],
      };
    case 'noCommits':
      return {
        icon: 'git-commit',
        title: t.noCommitsTitle,
        text: [t.noCommitsText],
        actions: [{ label: t.openScm, primary: false, msg: cmd('openScm') }],
      };
    case 'noGit':
      return {
        icon: 'error',
        danger: true,
        title: t.noGitTitle,
        text: [t.noGitText1, { code: 'git' }, t.noGitText2, { code: 'git.path' }, t.noGitText3],
        actions: [
          { label: t.downloadGit, primary: true, msg: cmd('downloadGit') },
          { label: t.openGitPath, primary: false, msg: cmd('openGitPathSetting') },
        ],
      };
    case 'noWorkspace':
      return {
        icon: 'folder-opened',
        title: t.noWorkspaceTitle,
        text: [t.noWorkspaceText],
        actions: [{ label: t.openFolder, primary: true, msg: cmd('openFolder') }],
      };
    case 'unknown':
      return {
        icon: 'warning',
        title: t.loadFailedTitle,
        text: [message || t.unexpectedError],
        actions: [{ label: t.retry, primary: true, msg: { type: 'refresh' } }],
      };
  }
}

export function renderState(el: HTMLElement, state: PanelState, post: (msg: WebviewToExtension) => void): void {
  el.classList.add('rr-p-state');
  if (state.kind === 'loading') {
    renderLoading(el, state.progress);
    return;
  }

  const spec = errorSpec(state.code, state.message);
  const iconEl = h('span', `codicon codicon-${spec.icon} rr-p-state-icon${spec.danger ? ' is-danger' : ''}`);
  iconEl.setAttribute('aria-hidden', 'true');

  const text = h('p', 'rr-p-state-text');
  for (const part of spec.text) text.append(typeof part === 'string' ? part : h('code', 'rr-p-code', part.code));

  const actions = h(
    'div',
    'rr-p-state-actions',
    spec.actions.map((a) => {
      const btn = h('button', `rr-p-btn ${a.primary ? 'rr-p-btn-primary' : 'rr-p-btn-secondary'}`, a.label);
      btn.type = 'button';
      btn.addEventListener('click', () => post(a.msg));
      return btn;
    }),
  );

  const box = h('div', 'rr-p-state-center', [iconEl, h('h2', 'rr-p-state-title', spec.title), text, actions]);
  box.setAttribute('role', 'alert');
  el.replaceChildren(box);
}

/** Yükleme ekranı zaten çiziliyse yalnızca çubuğu günceller (sık ilerleme mesajları için). */
function renderLoading(el: HTMLElement, progress: number): void {
  const t = text();
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) * 100);
  let bar = el.querySelector<HTMLElement>('.rr-p-progress');
  if (!bar) {
    const skeleton = h('div', 'rr-p-skeleton');
    skeleton.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 7; i++) skeleton.append(h('span', `rr-p-skeleton-box rr-p-skeleton-${i}`));

    bar = h('div', 'rr-p-progress', [h('div', 'rr-p-progress-fill')]);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', t.scanAria);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');

    const dialog = h('div', 'rr-p-state-dialog', [
      h('div', 'rr-p-state-dialog-title', t.scanTitle),
      bar,
      h('div', 'rr-p-progress-pct rr-p-muted'),
      h('div', 'rr-p-muted', t.scanNote),
    ]);
    el.replaceChildren(h('div', 'rr-p-state-loading', [skeleton, dialog]));
  }
  bar.setAttribute('aria-valuenow', String(pct));
  bar.setAttribute('aria-valuetext', t.pct(pct));
  bar.querySelector<HTMLElement>('.rr-p-progress-fill')?.style.setProperty('width', `${pct}%`);
  const pctEl = el.querySelector<HTMLElement>('.rr-p-progress-pct');
  if (pctEl) pctEl.textContent = t.pct(pct);
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
