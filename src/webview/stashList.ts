// Saklananlar (stash) listesi: katlanabilir başlık, "Değişiklikleri sakla" formu, uygula / uygula ve sil / sil.
// Başlık ve form bir kez kurulur (yazılan mesaj ve odak korunur); yalnızca satırlar yeniden çizilir.
import './ops.css';
import type { GitOpRequest, StashEntry } from '../types';
import { formatDate, formatRelative } from './format';

export interface StashListOptions {
  busy: boolean;
  onOp: (op: GitOpRequest) => void;
  /** Saklanacak değişiklik var mı? */
  canSave: boolean;
}

interface ListState {
  opts: StashListOptions;
  toggle: HTMLButtonElement;
  title: HTMLElement;
  body: HTMLElement;
  saveBtn: HTMLButtonElement;
  form: HTMLElement;
  message: HTMLInputElement;
  untracked: HTMLInputElement;
  submit: HTMLButtonElement;
  list: HTMLElement;
  expanded: boolean;
}

const states = new WeakMap<HTMLElement, ListState>();

export function renderStashList(el: HTMLElement, stashes: StashEntry[], opts: StashListOptions): void {
  let st = states.get(el);
  if (!st || !el.contains(st.toggle)) st = build(el, opts);
  st.opts = opts;

  st.title.textContent = `SAKLANANLAR (STASH) · ${stashes.length}`;
  st.toggle.setAttribute('aria-expanded', String(st.expanded));
  st.body.hidden = !st.expanded;

  st.saveBtn.disabled = opts.busy || !opts.canSave;
  st.saveBtn.title = opts.canSave ? 'Commit edilmemiş değişiklikleri kenara kaldırır (git stash push).' : 'Saklanacak değişiklik yok.';
  if (!opts.canSave && !st.form.hidden) closeForm(st, false);
  st.submit.disabled = opts.busy;

  const now = Date.now();
  if (stashes.length === 0) {
    st.list.replaceChildren(h('li', 'rr-op-muted rr-op-stash-empty', 'Saklanan değişiklik yok.'));
    return;
  }
  st.list.replaceChildren(
    ...stashes.map((s) => {
      const meta = [s.branch, formatRelative(s.date, now)].filter(Boolean).join(' · ');
      const metaEl = h('span', 'rr-p-meta', meta);
      metaEl.title = formatDate(s.date);
      const msg = h('span', 'rr-p-msg', s.message || '(mesajsız)');
      msg.title = s.message;
      const ref = `stash@{${s.index}}`;
      const btn = (label: string, aria: string, op: GitOpRequest, primary = false): HTMLButtonElement => {
        const b = h('button', `rr-p-btn ${primary ? 'rr-p-btn-primary' : 'rr-p-btn-secondary'} rr-p-btn-small`, label);
        b.type = 'button';
        b.disabled = opts.busy;
        b.setAttribute('aria-label', `${ref}: ${aria}`);
        b.addEventListener('click', () => st.opts.onOp(op));
        return b;
      };
      return h('li', 'rr-op-stash', [
        h('div', 'rr-op-stash-text', [h('span', 'rr-op-stash-top', [h('code', 'rr-op-hash', ref), msg]), metaEl]),
        h('div', 'rr-op-stash-actions', [
          btn('Uygula', 'uygula, listede kalsın', { kind: 'stashApply', index: s.index, pop: false }),
          btn('Uygula ve sil', 'uygula ve listeden sil', { kind: 'stashApply', index: s.index, pop: true }),
          btn('Sil', 'sil', { kind: 'stashDrop', index: s.index }),
        ]),
      ]);
    }),
  );
}

function build(el: HTMLElement, opts: StashListOptions): ListState {
  el.classList.add('rr-op-stashes');
  const uid = Math.random().toString(36).slice(2, 8);

  const chevron = h('span', 'codicon codicon-chevron-down rr-op-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  const title = h('span', '');
  const toggle = h('button', 'rr-op-section-toggle rr-p-heading', [chevron, title]);
  toggle.type = 'button';
  const bodyId = `rr-op-stash-body-${uid}`;
  toggle.setAttribute('aria-controls', bodyId);

  const saveBtn = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', 'Değişiklikleri sakla');
  saveBtn.type = 'button';

  const msgId = `rr-op-stash-msg-${uid}`;
  const message = h('input', 'rr-op-input');
  message.type = 'text';
  message.id = msgId;
  message.placeholder = 'Mesaj (isteğe bağlı)';
  message.autocomplete = 'off';
  const msgLabel = h('label', 'rr-visually-hidden', 'Stash mesajı');
  msgLabel.htmlFor = msgId;
  const untracked = h('input', '');
  untracked.type = 'checkbox';
  const submit = h('button', 'rr-p-btn rr-p-btn-primary rr-p-btn-small', 'Sakla');
  submit.type = 'button';
  const cancel = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', 'Vazgeç');
  cancel.type = 'button';
  const form = h('div', 'rr-op-stash-form', [
    msgLabel,
    message,
    h('label', 'rr-op-check', [untracked, h('span', '', 'İzlenmeyen dosyalar dahil')]),
    h('div', 'rr-op-actions', [submit, cancel]),
  ]);
  form.setAttribute('role', 'group');
  form.setAttribute('aria-label', 'Değişiklikleri sakla');
  form.hidden = true;

  const list = h('ul', 'rr-op-stash-list');
  const body = h('div', 'rr-op-stash-body', [h('div', 'rr-op-stash-tools', [saveBtn]), form, list]);
  body.id = bodyId;

  el.replaceChildren(h('div', 'rr-op-section-head', [toggle]), body);

  const st: ListState = { opts, toggle, title, body, saveBtn, form, message, untracked, submit, list, expanded: true };
  states.set(el, st);

  toggle.addEventListener('click', () => {
    st.expanded = !st.expanded;
    toggle.setAttribute('aria-expanded', String(st.expanded));
    body.hidden = !st.expanded;
  });
  saveBtn.addEventListener('click', () => {
    form.hidden = false;
    saveBtn.hidden = true;
    message.focus();
  });
  const send = (): void => {
    if (st.opts.busy) return;
    const text = message.value.trim();
    st.opts.onOp({ kind: 'stashSave', message: text || undefined, includeUntracked: untracked.checked });
    closeForm(st, true);
  };
  submit.addEventListener('click', send);
  cancel.addEventListener('click', () => closeForm(st, true));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeForm(st, true);
    } else if (e.key === 'Enter' && e.target === message) {
      e.preventDefault();
      send();
    }
  });
  return st;
}

function closeForm(st: ListState, focusButton: boolean): void {
  st.form.hidden = true;
  st.saveBtn.hidden = false;
  st.message.value = '';
  st.untracked.checked = false;
  if (focusButton && !st.saveBtn.disabled) st.saveBtn.focus();
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
