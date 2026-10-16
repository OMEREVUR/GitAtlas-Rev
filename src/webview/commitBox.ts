// "Değişiklikler" sekmesinin commit kutusu: tür çipleri, özet + açıklama, amend, commit / commit ve gönder.
// DOM bir kez kurulur; sonraki çağrılar yalnızca durumu günceller (yazılan metin, imleç ve odak korunur).
import './ops.css';
import type { GitOpRequest, WorkingTreeStatus } from '../types';
import { formatCommand, opCommands } from '../git/opCommands';

export interface CommitBoxOptions {
  status: WorkingTreeStatus;
  busy: boolean;
  onOp: (op: GitOpRequest) => void;
}

const TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'] as const;
const SOFT_LIMIT = 50;
const HARD_LIMIT = 72;
/** "feat: ", "fix(scope): ", "feat!: " gibi conventional commit önekleri. */
const PREFIX_RE = /^([a-z]+)(\([^)]*\))?!?:\s*/;

interface BoxState {
  opts: CommitBoxOptions;
  chips: Map<string, HTMLButtonElement>;
  summary: HTMLInputElement;
  counter: HTMLElement;
  body: HTMLTextAreaElement;
  amendRow: HTMLElement;
  amend: HTMLInputElement;
  amendWarn: HTMLElement;
  commit: HTMLButtonElement;
  commitPush: HTMLButtonElement;
  hint: HTMLElement;
  cmd: HTMLElement;
  last: HTMLElement;
  lastText: HTMLElement;
  undo: HTMLButtonElement;
  /** Amend işaretlenmeden önce yazılanlar (kaldırınca geri gelir). */
  saved?: { summary: string; body: string };
  amendHash?: string;
}

const states = new WeakMap<HTMLElement, BoxState>();

export function renderCommitBox(el: HTMLElement, opts: CommitBoxOptions): void {
  let st = states.get(el);
  if (!st || !el.contains(st.summary)) st = build(el, opts);
  st.opts = opts;

  const lc = opts.status.lastCommit;
  st.amendRow.hidden = !lc;
  // Son commit değiştiyse (ya da yoksa) amend kendiliğinden kalkar.
  if (st.amend.checked && (!lc || lc.hash !== st.amendHash)) setAmend(st, false);

  st.last.hidden = !lc;
  if (lc) {
    st.lastText.replaceChildren(h('code', 'rr-op-hash', lc.shortHash), document.createTextNode(` ${lc.message.split('\n')[0] ?? ''}`));
    st.lastText.title = lc.message;
  }
  update(st);
}

/** Commit başarıyla bitince alanları temizler. */
export function resetCommitBox(el: HTMLElement): void {
  const st = states.get(el);
  if (!st) return;
  st.summary.value = '';
  st.body.value = '';
  st.saved = undefined;
  st.amend.checked = false;
  st.amendHash = undefined;
  update(st);
}

function build(el: HTMLElement, opts: CommitBoxOptions): BoxState {
  el.classList.add('rr-op-commit');
  const uid = Math.random().toString(36).slice(2, 8);

  const chipRow = h('div', 'rr-op-chips');
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', 'Commit türü');
  const chips = new Map<string, HTMLButtonElement>();
  for (const t of [...TYPES, '']) {
    const b = h('button', 'rr-op-chip', t || 'yok');
    b.type = 'button';
    b.dataset.type = t;
    b.title = t ? `Özetin başına "${t}: " ekler` : 'Tür önekini kaldırır';
    chips.set(t, b);
    chipRow.append(b);
  }

  const summaryId = `rr-op-summary-${uid}`;
  const counterId = `rr-op-counter-${uid}`;
  const summary = h('input', 'rr-op-input');
  summary.type = 'text';
  summary.id = summaryId;
  summary.placeholder = 'Özet (ör. fix: boş repoda çökme)';
  summary.autocomplete = 'off';
  summary.spellcheck = true;
  summary.setAttribute('aria-describedby', counterId);
  const counter = h('span', 'rr-op-counter');
  counter.id = counterId;
  const summaryLabel = h('label', 'rr-op-label', 'Özet');
  summaryLabel.htmlFor = summaryId;

  const bodyId = `rr-op-body-${uid}`;
  const body = h('textarea', 'rr-op-input rr-op-textarea');
  body.id = bodyId;
  body.rows = 3;
  body.placeholder = 'Açıklama (isteğe bağlı): neden, nasıl…';
  const bodyLabel = h('label', 'rr-visually-hidden', 'Açıklama');
  bodyLabel.htmlFor = bodyId;

  const amend = h('input', '');
  amend.type = 'checkbox';
  const amendWarn = h('div', 'rr-op-warn', [icon('warning'), h('span', '', 'Bu commit gönderilmiş; değiştirmek geçmişi yeniden yazar.')]);
  amendWarn.setAttribute('role', 'note');
  const amendRow = h('div', 'rr-op-amend', [
    h('label', 'rr-op-check', [amend, h('span', '', "Son commit'e ekle (amend)")]),
    amendWarn,
  ]);

  const commit = h('button', 'rr-p-btn rr-p-btn-primary', 'Commit');
  commit.type = 'button';
  const commitPush = h('button', 'rr-p-btn rr-p-btn-secondary', 'Commit ve gönder');
  commitPush.type = 'button';
  const hint = h('div', 'rr-op-hint');
  hint.id = `rr-op-hint-${uid}`;
  commit.setAttribute('aria-describedby', hint.id);
  commitPush.setAttribute('aria-describedby', hint.id);

  const cmd = h('div', 'rr-op-cmd');
  cmd.setAttribute('aria-label', 'Çalışacak komut');

  const lastText = h('span', 'rr-op-last-text');
  const undo = h('button', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', "Son commit'i geri al");
  undo.type = 'button';
  undo.title = "Değişiklikler kaybolmaz, commit'e girecekler listesine döner.";
  const last = h('div', 'rr-op-last', [
    h('div', 'rr-op-last-line', [h('span', 'rr-op-muted', 'Son commit:'), lastText]),
    h('div', 'rr-op-last-line', [undo, h('span', 'rr-op-muted', "değişiklikler kaybolmaz, commit'e girecekler listesine döner")]),
  ]);

  el.replaceChildren(
    chipRow,
    h('div', 'rr-op-field', [h('div', 'rr-op-field-head', [summaryLabel, counter]), summary]),
    h('div', 'rr-op-field', [bodyLabel, body]),
    amendRow,
    h('div', 'rr-op-actions', [commit, commitPush]),
    hint,
    cmd,
    last,
  );

  const st: BoxState = {
    opts,
    chips,
    summary,
    counter,
    body,
    amendRow,
    amend,
    amendWarn,
    commit,
    commitPush,
    hint,
    cmd,
    last,
    lastText,
    undo,
  };
  states.set(el, st);

  for (const [t, b] of chips) {
    b.addEventListener('click', () => {
      summary.value = withType(summary.value, t);
      update(st);
    });
  }
  summary.addEventListener('input', () => update(st));
  body.addEventListener('input', () => update(st));
  amend.addEventListener('change', () => setAmend(st, amend.checked));
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit(st, false);
    }
  };
  summary.addEventListener('keydown', onKey);
  body.addEventListener('keydown', onKey);
  commit.addEventListener('click', () => submit(st, false));
  commitPush.addEventListener('click', () => submit(st, true));
  undo.addEventListener('click', () => st.opts.onOp({ kind: 'undoLastCommit' }));
  return st;
}

function setAmend(st: BoxState, on: boolean): void {
  st.amend.checked = on;
  const lc = st.opts.status.lastCommit;
  if (on && lc) {
    st.saved = { summary: st.summary.value, body: st.body.value };
    st.amendHash = lc.hash;
    const [first = '', ...rest] = lc.message.split('\n');
    st.summary.value = first;
    st.body.value = rest.join('\n').replace(/^\n+/, '');
  } else if (!on) {
    if (st.saved) {
      st.summary.value = st.saved.summary;
      st.body.value = st.saved.body;
    }
    st.saved = undefined;
    st.amendHash = undefined;
  }
  update(st);
}

function message(st: BoxState): string {
  const s = st.summary.value.trim();
  const b = st.body.value.trim();
  return b ? `${s}\n\n${b}` : s;
}

/** Commit'i engelleyen sebep; yoksa undefined. */
function blocker(st: BoxState): string | undefined {
  const { status, busy } = st.opts;
  if (busy) return 'Bir işlem sürüyor…';
  const staged = status.files.some((f) => f.staged !== undefined);
  if (!staged && !st.amend.checked) return "Önce commit'e girecek dosyaları seçin.";
  if (!st.summary.value.trim()) return 'Bir özet yazın.';
  return undefined;
}

function submit(st: BoxState, push: boolean): void {
  if (blocker(st)) return;
  st.opts.onOp({ kind: 'commit', message: message(st), amend: st.amend.checked, push });
}

function update(st: BoxState): void {
  const { status } = st.opts;
  const len = st.summary.value.length;
  st.counter.textContent = `${len}/${SOFT_LIMIT}`;
  st.counter.classList.toggle('is-warn', len > SOFT_LIMIT && len <= HARD_LIMIT);
  st.counter.classList.toggle('is-strong', len > HARD_LIMIT);
  st.counter.title =
    len > HARD_LIMIT
      ? `${HARD_LIMIT} karakteri geçti; çoğu araç özeti keser.`
      : len > SOFT_LIMIT
        ? `Özet ${SOFT_LIMIT} karakteri geçti; kısa tutmak önerilir.`
        : `Özet ${SOFT_LIMIT} karakterin altında.`;

  const current = PREFIX_RE.exec(st.summary.value)?.[1] ?? '';
  const known = (TYPES as readonly string[]).includes(current) ? current : '';
  for (const [t, b] of st.chips) b.setAttribute('aria-pressed', String(t === known));

  const lc = status.lastCommit;
  st.amendWarn.hidden = !(st.amend.checked && lc?.pushed);

  const reason = blocker(st);
  st.commit.disabled = reason !== undefined;
  st.commitPush.disabled = reason !== undefined || status.branch === undefined;
  st.commitPush.title = status.branch === undefined ? 'Ayrık HEAD gönderilemez' : '';
  st.hint.textContent = reason && !st.opts.busy ? reason : '';
  st.hint.hidden = !st.hint.textContent;
  st.undo.disabled = st.opts.busy;

  const msg = message(st) || (st.amend.checked ? '' : '<özet>');
  const lines = opCommands({ kind: 'commit', message: msg, amend: st.amend.checked, push: false }, status).map(formatCommand);
  st.cmd.replaceChildren(h('span', 'rr-op-muted', 'Çalışacak komut:'), ...lines.map((l) => h('code', 'rr-op-cmd-line', l)));
  st.cmd.title = lines.join('\n');
}

/** Özetin önekini verilen türle değiştirir; '' öneki kaldırır. */
export function withType(summary: string, type: string): string {
  const m = PREFIX_RE.exec(summary);
  const rest = m && (TYPES as readonly string[]).includes(m[1] ?? '') ? summary.slice(m[0].length) : summary;
  return type ? `${type}: ${rest}` : rest;
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
