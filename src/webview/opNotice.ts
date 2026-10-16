// Git işlemi bildirimi: çalışıyor / başarılı (6 sn sonra solar) / hata (kalıcı) / iptal.
import './ops.css';
import type { GitOpKind, OpResult } from '../types';
import type { WebviewToExtension } from '../protocol';

export interface OpNoticeState {
  running?: { kind: GitOpKind; commands: string[] };
  last?: OpResult;
}

const FADE_AFTER_MS = 6000;
const FADE_MS = 300;

interface NoticeMemory {
  /** Kapatılan ya da solup giden sonucun kimliği; aynı sonuç tekrar gösterilmez. */
  dismissedId?: string;
  /** Zamanlayıcısı kurulmuş sonucun kimliği. */
  timedId?: string;
  timer?: number;
  /** Şu an çizili sonucun kimliği (aynı sonuç yeniden çizilmez; açık "Ayrıntı" kapanmaz). */
  renderedId?: string;
}

const memory = new WeakMap<HTMLElement, NoticeMemory>();

export function renderOpNotice(el: HTMLElement, state: OpNoticeState, post: (msg: WebviewToExtension) => void): void {
  el.classList.add('rr-op-notice');
  let mem = memory.get(el);
  if (!mem) {
    mem = {};
    memory.set(el, mem);
  }
  const m = mem;

  const clearTimer = (): void => {
    if (m.timer !== undefined) window.clearTimeout(m.timer);
    m.timer = undefined;
    m.timedId = undefined;
  };
  const hide = (): void => {
    el.replaceChildren();
    el.hidden = true;
    el.classList.remove('is-fading');
  };

  if (state.running) {
    clearTimer();
    m.renderedId = undefined;
    el.classList.remove('is-fading');
    el.dataset.tone = 'running';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const [first = '', ...more] = state.running.commands;
    const text = h('span', 'rr-op-notice-text', [
      document.createTextNode('Çalışıyor: '),
      h('code', 'rr-op-code', first || state.running.kind),
    ]);
    if (more.length > 0) text.append(h('span', 'rr-op-muted', ` (+${more.length} komut)`));
    const bar = h('span', 'rr-op-progress', [h('span', 'rr-op-progress-fill')]);
    bar.setAttribute('aria-hidden', 'true');
    el.replaceChildren(
      h('div', 'rr-op-notice-line', [icon('loading codicon-modifier-spin', 'rr-op-notice-icon'), text]),
      bar,
    );
    el.hidden = false;
    return;
  }

  const last = state.last;
  if (!last || last.id === m.dismissedId) {
    clearTimer();
    m.renderedId = undefined;
    return hide();
  }
  if (last.id === m.renderedId && !el.hidden) return;
  m.renderedId = last.id;

  const tone = last.cancelled ? 'cancelled' : last.ok ? 'ok' : 'error';
  el.dataset.tone = tone;
  if (tone === 'error') {
    el.setAttribute('role', 'alert');
    el.removeAttribute('aria-live');
  } else {
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
  }

  const dismiss = (): void => {
    m.dismissedId = last.id;
    m.renderedId = undefined;
    clearTimer();
    hide();
  };

  const iconName = tone === 'ok' ? 'pass' : tone === 'error' ? 'error' : 'circle-slash';
  const msg = tone === 'cancelled' ? 'İptal edildi.' : last.message;
  const children: HTMLElement[] = [h('div', 'rr-op-notice-line', [icon(iconName, 'rr-op-notice-icon'), h('span', 'rr-op-notice-text', msg)])];

  if (last.detail && tone !== 'cancelled') {
    const pre = h('pre', 'rr-op-detail', last.detail);
    pre.tabIndex = 0;
    const details = h('details', 'rr-op-details', [h('summary', '', 'Ayrıntı'), pre]);
    // Ayrıntı açılınca kendiliğinden solmasın.
    details.addEventListener('toggle', () => {
      if (details.open && m.timer !== undefined) {
        window.clearTimeout(m.timer);
        m.timer = undefined;
        el.classList.remove('is-fading');
      }
    });
    children.push(details);
  }

  const output = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', 'Çıktıyı göster');
  output.type = 'button';
  output.addEventListener('click', () => post({ type: 'showOutput' }));
  const close = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', 'Kapat');
  close.type = 'button';
  close.addEventListener('click', dismiss);
  children.push(h('div', 'rr-op-notice-actions', [output, close]));

  el.classList.remove('is-fading');
  el.replaceChildren(...children);
  el.hidden = false;

  // Başarı ve iptal 6 sn sonra solar; hata kalıcı. Aynı sonuç yeniden çizilirse zamanlayıcı baştan kurulmaz.
  if (tone !== 'error' && m.timedId !== last.id) {
    clearTimer();
    m.timedId = last.id;
    m.timer = window.setTimeout(() => {
      el.classList.add('is-fading');
      m.timer = window.setTimeout(dismiss, FADE_MS);
    }, FADE_AFTER_MS);
  } else if (tone === 'error') {
    clearTimer();
  }
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
