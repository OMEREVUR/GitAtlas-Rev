// GitHub durum bandı (tasarım: GitHub.dc.html): kapalı, bağlanıyor, bağlandı, eski veri, GitHub değil, hata.
import type { CiState, GitHubData, PullRequest, RateLimitInfo } from '../types';
import type { WebviewToExtension } from '../protocol';
import { formatNumber, formatRelative } from './format';
import { locale } from '../i18n';
import { text } from '../i18n/graph';

/** Dosya → ona dokunan açık PR sayısı. 2+ olanlar çakışma riskidir. */
export function conflictFiles(prs: readonly PullRequest[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const pr of prs) {
    for (const f of new Set(pr.files)) map.set(f, (map.get(f) ?? 0) + 1);
  }
  return map;
}

/** CI durumunun etkin dildeki etiketi ("CI geçti" / "CI passed"). */
export function ciLabel(ci: CiState): string {
  const t = text();
  switch (ci) {
    case 'success':
      return t.ciSuccess;
    case 'failure':
      return t.ciFailure;
    case 'pending':
      return t.ciPending;
    case 'none':
      return t.ciNone;
  }
}

/** Eski kullanım için: her okumada etkin dile göre (getter'lar). Yeni kodda ciLabel tercih edilir. */
export const CI_LABELS: Readonly<Record<CiState, string>> = {
  get success() {
    return ciLabel('success');
  },
  get failure() {
    return ciLabel('failure');
  },
  get pending() {
    return ciLabel('pending');
  },
  get none() {
    return ciLabel('none');
  },
};

/** Açık PR satırı (dosya kartı ve seçim ayrıntısı ortak): tıklayınca PR GitHub'da açılır. */
export function prRow(pr: PullRequest, post: (msg: WebviewToExtension) => void): HTMLButtonElement {
  const t = text();
  const title = h('span', 'rr-p-msg', `#${pr.number} ${pr.title}`);
  const dot = h('span', `rr-p-ci-dot is-${pr.ci}`);
  dot.setAttribute('aria-hidden', 'true');
  const meta = h('span', 'rr-p-pr-meta', [
    h('span', '', pr.author),
    h('span', 'rr-p-pr-sep', '·'),
    dot,
    h('span', '', ciLabel(pr.ci)),
  ]);
  if (pr.isDraft) meta.append(h('span', 'rr-p-tag', t.draft));
  const prIcon = h('span', 'codicon codicon-git-pull-request rr-p-pr-icon');
  prIcon.setAttribute('aria-hidden', 'true');
  const btn = h('button', 'rr-p-pr-row', [prIcon, h('span', 'rr-p-pr-text', [title, meta])]);
  btn.type = 'button';
  btn.title = `${pr.title}\n${pr.headRef} → ${pr.baseRef}\n${t.openOnGitHub}`;
  btn.addEventListener('click', () => post({ type: 'openUrl', url: pr.url }));
  return btn;
}

/** "GitHub değil" bilgisini kapatan kullanıcı için, aynı remote yeniden çizilince bant geri gelmesin. */
const hiddenNotGitHub = new Set<string>();
/** "Bu repo GitHub'da değil" bandını "Şimdi değil" ile kapatan kullanıcı için (webview oturumu boyunca). */
let hiddenNoRemote = false;

type Tone = 'info' | 'warning' | 'error' | 'neutral';

export function renderGitHubBanner(
  el: HTMLElement,
  data: GitHubData | undefined,
  post: (msg: WebviewToExtension) => void,
): void {
  el.classList.add('rr-p-gh');
  el.setAttribute('role', 'status');
  const status = data?.status;
  const now = Date.now();
  const t = text();

  const hide = (): void => {
    el.replaceChildren();
    el.hidden = true;
  };
  const show = (tone: Tone, ...children: Node[]): void => {
    el.dataset.tone = tone;
    el.replaceChildren(...children);
    el.hidden = false;
  };

  if (!status) return hide();
  switch (status.state) {
    case 'noRemote':
      if (hiddenNoRemote) return hide();
      return show(
        'info',
        icon('github'),
        h('div', 'rr-p-gh-body', [
          textLine(t.noRemoteTitle, t.noRemoteText),
          actions([
            button(t.publish, true, () => post({ type: 'githubPublish' })),
            button(t.notNow, false, () => {
              hiddenNoRemote = true;
              hide();
            }),
          ]),
        ]),
      );

    case 'off':
      if (status.dismissed) return hide();
      return show(
        'info',
        icon('github'),
        h('div', 'rr-p-gh-body', [
          textLine(t.offTitle, t.offText),
          actions([
            button(t.connect, true, () => post({ type: 'githubConnect' })),
            button(t.notNow, false, () => post({ type: 'githubDismiss' })),
          ]),
        ]),
      );

    case 'connecting': {
      const bar = h('span', 'rr-p-gh-progress', [h('span', 'rr-p-gh-progress-fill')]);
      bar.setAttribute('aria-hidden', 'true');
      return show('neutral', h('div', 'rr-p-gh-body', [h('span', '', t.connecting), bar]));
    }

    case 'connected': {
      const prs = data?.pullRequests ?? [];
      const risky = [...conflictFiles(prs).values()].filter((n) => n >= 2).length;
      const parts = [status.repo, t.openPrs(prs.length, formatNumber(prs.length))];
      if (risky > 0) parts.push(t.conflictRisk(risky, formatNumber(risky)));
      const rel = formatRelative(status.fetchedAt, now);

      const refresh = h('button', 'rr-p-icon-btn', [icon('refresh')]);
      refresh.type = 'button';
      refresh.setAttribute('aria-label', t.refreshAria);
      refresh.title = t.refreshTitle(rel);
      refresh.addEventListener('click', () => post({ type: 'githubRefresh' }));

      const line = h('div', 'rr-p-gh-line', [
        icon('github'),
        h('span', 'rr-p-gh-summary', [strong(t.connected), document.createTextNode(` · ${parts.join(' · ')}`)]),
        h('span', 'rr-p-gh-time', t.updated(rel)),
        refresh,
      ]);

      const rl = status.rateLimit;
      const lowLimit = rl !== undefined && rl.limit > 0 && rl.remaining < rl.limit * 0.1;
      const slowed = status.intervalMin > status.baseIntervalMin;
      if (!lowLimit && !slowed) return show('neutral', line);

      let msg = rl ? t.remaining(formatNumber(rl.remaining), formatNumber(rl.limit)) : '';
      if (slowed) msg += t.slowed(status.baseIntervalMin, status.intervalMin);
      if (rl) msg += ` ${resetText(rl)}`;
      const warn = h('div', 'rr-p-gh-line rr-p-gh-warn', [icon('warning'), textLine(t.rateLow, msg)]);
      return show('warning', h('div', 'rr-p-gh-stack', [line, warn]));
    }

    case 'stale': {
      const shown = status.fetchedAt > 0 ? t.shownAsOf(formatRelative(status.fetchedAt, now)) : t.shownLast;
      let body: HTMLElement;
      const acts: HTMLButtonElement[] = [];
      if (status.reason === 'sessionExpired') {
        body = textLine(t.sessionExpired, `${shown}${t.gitUpToDate}`);
        acts.push(button(t.signInAgain, true, () => post({ type: 'githubConnect' })));
      } else if (status.reason === 'offline') {
        body = textLine(t.offline, `${shown}${t.gitUpToDate}`);
        acts.push(button(t.retry, false, () => post({ type: 'githubRefresh' })));
      } else {
        const reset = status.rateLimit ? ` ${resetText(status.rateLimit)}` : '';
        body = textLine(t.rateExceeded, `${shown}${reset}`);
      }
      const children: HTMLElement[] = [body];
      if (acts.length > 0) children.push(actions(acts));
      return show('warning', icon('warning'), h('div', 'rr-p-gh-body', children));
    }

    case 'notGitHub': {
      if (hiddenNotGitHub.has(status.remoteUrl)) return hide();
      const close = h('button', 'rr-p-icon-btn', [icon('close')]);
      close.type = 'button';
      close.setAttribute('aria-label', t.dismissInfo);
      close.title = t.dismissInfo;
      close.addEventListener('click', () => {
        hiddenNotGitHub.add(status.remoteUrl);
        hide();
        post({ type: 'githubDismiss' });
      });
      const msg = h('span', 'rr-p-gh-text', [
        strong(t.notGitHub),
        document.createTextNode(' '),
        h('code', 'rr-p-code', status.remoteUrl),
        document.createTextNode(t.notGitHubText),
      ]);
      return show('neutral', icon('info'), h('div', 'rr-p-gh-body', [msg]), close);
    }

    case 'error':
      return show(
        'error',
        icon('error'),
        h('div', 'rr-p-gh-body', [
          // status.message eklentiden (githubLayer) gelir; dili orada belirlenir.
          textLine(t.errorTitle, status.message ? ` ${status.message}` : ''),
          actions([button(t.retry, false, () => post({ type: 'githubRefresh' }))]),
        ]),
      );
  }
}

function resetText(rl: RateLimitInfo): string {
  const time = new Date(rl.resetAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return text().resetAt(time);
}

function textLine(bold: string, rest: string): HTMLElement {
  return h('span', 'rr-p-gh-text', [strong(bold), document.createTextNode(rest)]);
}

function strong(s: string): HTMLElement {
  return h('strong', '', s);
}

function actions(buttons: HTMLButtonElement[]): HTMLElement {
  return h('div', 'rr-p-gh-actions', buttons);
}

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = h('button', `rr-p-btn rr-p-btn-gh ${primary ? 'rr-p-btn-primary' : 'rr-p-btn-secondary'}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
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
  const span = h('span', `codicon codicon-${name} rr-p-gh-icon`);
  span.setAttribute('aria-hidden', 'true');
  return span;
}
