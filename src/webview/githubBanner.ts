// GitHub durum bandı (tasarım: GitHub.dc.html): kapalı, bağlanıyor, bağlandı, eski veri, GitHub değil, hata.
import type { CiState, GitHubData, PullRequest, RateLimitInfo } from '../types';
import type { WebviewToExtension } from '../protocol';
import { formatNumber, formatRelative } from './format';

/** Dosya → ona dokunan açık PR sayısı. 2+ olanlar çakışma riskidir. */
export function conflictFiles(prs: readonly PullRequest[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const pr of prs) {
    for (const f of new Set(pr.files)) map.set(f, (map.get(f) ?? 0) + 1);
  }
  return map;
}

export const CI_LABELS: Record<CiState, string> = {
  success: 'CI geçti',
  failure: 'CI başarısız',
  pending: 'CI sürüyor',
  none: 'CI yok',
};

/** Açık PR satırı (dosya kartı ve seçim ayrıntısı ortak): tıklayınca PR GitHub'da açılır. */
export function prRow(pr: PullRequest, post: (msg: WebviewToExtension) => void): HTMLButtonElement {
  const title = h('span', 'rr-p-msg', `#${pr.number} ${pr.title}`);
  const dot = h('span', `rr-p-ci-dot is-${pr.ci}`);
  dot.setAttribute('aria-hidden', 'true');
  const meta = h('span', 'rr-p-pr-meta', [
    h('span', '', pr.author),
    h('span', 'rr-p-pr-sep', '·'),
    dot,
    h('span', '', CI_LABELS[pr.ci]),
  ]);
  if (pr.isDraft) meta.append(h('span', 'rr-p-tag', 'taslak'));
  const prIcon = h('span', 'codicon codicon-git-pull-request rr-p-pr-icon');
  prIcon.setAttribute('aria-hidden', 'true');
  const btn = h('button', 'rr-p-pr-row', [prIcon, h('span', 'rr-p-pr-text', [title, meta])]);
  btn.type = 'button';
  btn.title = `${pr.title}\n${pr.headRef} → ${pr.baseRef}\nGitHub'da aç`;
  btn.addEventListener('click', () => post({ type: 'openUrl', url: pr.url }));
  return btn;
}

/** "GitHub değil" bilgisini kapatan kullanıcı için, aynı remote yeniden çizilince bant geri gelmesin. */
const hiddenNotGitHub = new Set<string>();

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
      return hide();

    case 'off':
      if (status.dismissed) return hide();
      return show(
        'info',
        icon('github'),
        h('div', 'rr-p-gh-body', [
          text(
            'GitHub katmanı kapalı.',
            " Bağlanınca açık PR'lar, çakışmalar ve CI sonuçları haritaya eklenir. Token gerekmez; VS Code'daki GitHub oturumun kullanılır.",
          ),
          actions([
            button('GitHub ile bağlan', true, () => post({ type: 'githubConnect' })),
            button('Şimdi değil', false, () => post({ type: 'githubDismiss' })),
          ]),
        ]),
      );

    case 'connecting': {
      const bar = h('span', 'rr-p-gh-progress', [h('span', 'rr-p-gh-progress-fill')]);
      bar.setAttribute('aria-hidden', 'true');
      return show('neutral', h('div', 'rr-p-gh-body', [h('span', '', "Açık PR'lar ve CI sonuçları alınıyor…"), bar]));
    }

    case 'connected': {
      const prs = data?.pullRequests ?? [];
      const risky = [...conflictFiles(prs).values()].filter((n) => n >= 2).length;
      const parts = [status.repo, `${formatNumber(prs.length)} açık PR`];
      if (risky > 0) parts.push(`${formatNumber(risky)} dosyada çakışma riski`);

      const refresh = h('button', 'rr-p-icon-btn', [icon('refresh')]);
      refresh.type = 'button';
      refresh.setAttribute('aria-label', 'GitHub verisini yenile');
      refresh.title = `GitHub verisini yenile (${formatRelative(status.fetchedAt, now)} güncellendi)`;
      refresh.addEventListener('click', () => post({ type: 'githubRefresh' }));

      const line = h('div', 'rr-p-gh-line', [
        icon('github'),
        h('span', 'rr-p-gh-summary', [strong('GitHub bağlandı'), document.createTextNode(` · ${parts.join(' · ')}`)]),
        h('span', 'rr-p-gh-time', `${formatRelative(status.fetchedAt, now)} güncellendi`),
        refresh,
      ]);

      const rl = status.rateLimit;
      const lowLimit = rl !== undefined && rl.limit > 0 && rl.remaining < rl.limit * 0.1;
      const slowed = status.intervalMin > status.baseIntervalMin;
      if (!lowLimit && !slowed) return show('neutral', line);

      let msg = rl ? ` ${formatNumber(rl.remaining)} / ${formatNumber(rl.limit)} kaldı.` : '';
      if (slowed) msg += ` Yenileme aralığı ${status.baseIntervalMin} dakikadan ${status.intervalMin} dakikaya çıkarıldı.`;
      if (rl) msg += ` ${resetText(rl)}`;
      const warn = h('div', 'rr-p-gh-line rr-p-gh-warn', [icon('warning'), text('GitHub istek limiti azaldı:', msg)]);
      return show('warning', h('div', 'rr-p-gh-stack', [line, warn]));
    }

    case 'stale': {
      const age = status.fetchedAt > 0 ? formatRelative(status.fetchedAt, now).replace(/önce$/, 'önceki') : '';
      const shown = age ? ` PR ve CI bilgileri ${age} hâliyle gösteriliyor.` : ' PR ve CI bilgileri son alınan hâliyle gösteriliyor.';
      let body: HTMLElement;
      const acts: HTMLButtonElement[] = [];
      if (status.reason === 'sessionExpired') {
        body = text('GitHub oturumu sona erdi.', `${shown} Git katmanı güncel.`);
        acts.push(button('Yeniden oturum aç', true, () => post({ type: 'githubConnect' })));
      } else if (status.reason === 'offline') {
        body = text("GitHub'a ulaşılamıyor.", `${shown} Git katmanı güncel.`);
        acts.push(button('Yeniden dene', false, () => post({ type: 'githubRefresh' })));
      } else {
        const reset = status.rateLimit ? ` ${resetText(status.rateLimit)}` : '';
        body = text('GitHub istek limiti doldu.', `${shown}${reset}`);
      }
      const children: HTMLElement[] = [body];
      if (acts.length > 0) children.push(actions(acts));
      return show('warning', icon('warning'), h('div', 'rr-p-gh-body', children));
    }

    case 'notGitHub': {
      if (hiddenNotGitHub.has(status.remoteUrl)) return hide();
      const close = h('button', 'rr-p-icon-btn', [icon('close')]);
      close.type = 'button';
      close.setAttribute('aria-label', 'Bilgiyi kapat');
      close.title = 'Bilgiyi kapat';
      close.addEventListener('click', () => {
        hiddenNotGitHub.add(status.remoteUrl);
        hide();
        post({ type: 'githubDismiss' });
      });
      const msg = h('span', 'rr-p-gh-text', [
        strong('origin bir GitHub reposu değil'),
        document.createTextNode(' '),
        h('code', 'rr-p-code', status.remoteUrl),
        document.createTextNode('. GitHub katmanı kapalı kalır; harita, graph ve branch paneli normal çalışır.'),
      ]);
      return show('neutral', icon('info'), h('div', 'rr-p-gh-body', [msg]), close);
    }

    case 'error':
      return show(
        'error',
        icon('error'),
        h('div', 'rr-p-gh-body', [
          text('GitHub verisi alınamadı.', status.message ? ` ${status.message}` : ''),
          actions([button('Yeniden dene', false, () => post({ type: 'githubRefresh' }))]),
        ]),
      );
  }
}

function resetText(rl: RateLimitInfo): string {
  const t = new Date(rl.resetAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `Limit ${t} itibarıyla sıfırlanır.`;
}

function text(bold: string, rest: string): HTMLElement {
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
