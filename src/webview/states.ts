// Durum ekranları (tasarım: States.dc.html): ilk tarama ve hata durumları.
import type { ErrorCode, StateAction, WebviewToExtension } from '../protocol';

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
  switch (code) {
    case 'noRepo':
      return {
        icon: 'folder',
        title: 'Bu klasör bir git reposu değil',
        text: ['RewiewRev haritayı git geçmişinden çizer. Bu klasörde ', { code: '.git' }, ' bulunamadı.'],
        actions: [
          { label: 'Repoyu başlat', primary: true, msg: cmd('initRepo') },
          { label: 'Başka klasör aç', primary: false, msg: cmd('openFolder') },
        ],
      };
    case 'noCommits':
      return {
        icon: 'git-commit',
        title: 'Henüz commit yok',
        text: ["Harita ilk commit'ten sonra burada oluşur. Dosyaların boyutu ve değişim sıklığı commit'lerden hesaplanır."],
        actions: [{ label: 'Kaynak denetimini aç', primary: false, msg: cmd('openScm') }],
      };
    case 'noGit':
      return {
        icon: 'error',
        danger: true,
        title: 'Git bulunamadı',
        text: [
          'RewiewRev ',
          { code: 'git' },
          ' komutunu çalıştıramadı. Git kurulu değilse indir; kuruluysa yolunu ',
          { code: 'git.path' },
          ' ayarında belirt.',
        ],
        actions: [
          { label: "Git'i indir", primary: true, msg: cmd('downloadGit') },
          { label: 'git.path ayarını aç', primary: false, msg: cmd('openGitPathSetting') },
        ],
      };
    case 'noWorkspace':
      return {
        icon: 'folder-opened',
        title: 'Açık klasör yok',
        text: ['Haritayı görmek için bir git reposu içeren klasör aç.'],
        actions: [{ label: 'Klasör aç', primary: true, msg: cmd('openFolder') }],
      };
    case 'unknown':
      return {
        icon: 'warning',
        title: 'Harita yüklenemedi',
        text: [message || 'Beklenmeyen bir hata oluştu.'],
        actions: [{ label: 'Yeniden dene', primary: true, msg: { type: 'refresh' } }],
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
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) * 100);
  let bar = el.querySelector<HTMLElement>('.rr-p-progress');
  if (!bar) {
    const skeleton = h('div', 'rr-p-skeleton');
    skeleton.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 7; i++) skeleton.append(h('span', `rr-p-skeleton-box rr-p-skeleton-${i}`));

    bar = h('div', 'rr-p-progress', [h('div', 'rr-p-progress-fill')]);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Tarama ilerlemesi');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');

    const dialog = h('div', 'rr-p-state-dialog', [
      h('div', 'rr-p-state-dialog-title', 'Git geçmişi taranıyor'),
      bar,
      h('div', 'rr-p-progress-pct rr-p-muted'),
      h('div', 'rr-p-muted', "İlk tarama bir kez yapılır. Sonraki açılışlarda sadece yeni commit'ler işlenir."),
    ]);
    el.replaceChildren(h('div', 'rr-p-state-loading', [skeleton, dialog]));
  }
  bar.setAttribute('aria-valuenow', String(pct));
  bar.setAttribute('aria-valuetext', `%${pct}`);
  bar.querySelector<HTMLElement>('.rr-p-progress-fill')?.style.setProperty('width', `${pct}%`);
  const pctEl = el.querySelector<HTMLElement>('.rr-p-progress-pct');
  if (pctEl) pctEl.textContent = `%${pct}`;
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
