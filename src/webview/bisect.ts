// 0.4.0: Bisect sekmesi — başlamadan (form), sürerken (test edilecek commit + İyi/Kötü/Atla/Bitir), bulununca (sonuç kartı).
import './bisect.css';
import type { BisectState, CommitSummary, GitOpRequest, GitRef } from '../types';
import { formatCommand, opCommands } from '../git/opCommands';
import { text } from '../i18n/bisect';
import { baseName, formatNumber, formatRelative } from './format';

export interface BisectFormValues {
  bad: string;
  good?: string;
}

export interface BisectViewOptions {
  state: BisectState | undefined;
  /** hash → commit (harita commit'leri + graph); test edilen ve bulunan commit'in ayrıntısı için. */
  commitOf: (hash: string) => CommitSummary | undefined;
  /** Formdaki seçenekler: son commit'ler (en yeniden) ve etiketler. */
  recent: readonly CommitSummary[];
  tags: readonly GitRef[];
  /** Checkout edilmiş branch adı (HEAD seçeneğinin etiketi). */
  headName: string;
  form: BisectFormValues;
  /** Çalışma ağacında commit edilmemiş (izlenen) değişiklik var mı? */
  dirty: boolean;
  busy: boolean;
  now: number;
  onForm: (form: BisectFormValues) => void;
  onOp: (op: GitOpRequest) => void;
  onShowInMap: (hash: string) => void;
  onShowInGraph: (hash: string) => void;
  onOpenDiff: (path: string, hash: string) => void;
}

export function renderBisect(el: HTMLElement, opts: BisectViewOptions): void {
  el.classList.add('rr-bisect');
  const s = opts.state;
  if (!s) el.replaceChildren(idleView(opts));
  else if (s.firstBad) el.replaceChildren(foundView(s, s.firstBad, opts));
  else el.replaceChildren(activeView(s, opts));
}

// ---- başlamadan ----

function idleView(opts: BisectViewOptions): HTMLElement {
  const t = text();
  const box = h('section', 'rr-bs-card');
  box.append(h('h2', 'rr-bs-title', t.title), h('p', 'rr-bs-intro', t.intro));

  const form = h('div', 'rr-bs-form');
  const bad = select('rr-bs-bad', t.badLabel, opts, opts.form.bad, false);
  const good = select('rr-bs-good', t.goodLabel, opts, opts.form.good ?? '', true);
  bad.select.addEventListener('change', () => opts.onForm({ ...opts.form, bad: bad.select.value }));
  good.select.addEventListener('change', () => opts.onForm({ ...opts.form, good: good.select.value || undefined }));
  form.append(bad.wrap, good.wrap);
  box.append(form);

  const same = opts.form.good !== undefined && opts.form.good === opts.form.bad;
  if (same) box.append(note('rr-bs-warn', 'codicon-warning', t.sameCommit));
  if (opts.dirty) box.append(note('rr-bs-note', 'codicon-info', t.dirtyNote));

  const op: GitOpRequest | undefined = opts.form.good && !same ? { kind: 'bisectStart', bad: opts.form.bad, good: opts.form.good } : undefined;
  const start = button(t.start, 'rr-p-btn rr-p-btn-primary', !op || opts.busy, () => op && opts.onOp(op));
  const actions = h('div', 'rr-bs-actions');
  actions.append(start);
  box.append(actions);
  if (op) box.append(commandPreview(op));
  box.append(h('p', 'rr-bs-tip', t.graphTip));
  return box;
}

function select(
  id: string,
  label: string,
  opts: BisectViewOptions,
  value: string,
  allowEmpty: boolean,
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const t = text();
  const wrap = h('div', 'rr-bs-field');
  const lab = h('label', 'rr-bs-label', label);
  lab.htmlFor = id;
  const sel = h('select', 'rr-bs-select');
  sel.id = id;
  if (allowEmpty) sel.append(option('', t.pickOption));
  else sel.append(option('HEAD', t.headOption(opts.headName)));
  if (opts.tags.length) {
    const g = h('optgroup');
    g.label = t.tagsGroup;
    for (const r of opts.tags) g.append(option(r.name, r.name));
    sel.append(g);
  }
  const g = h('optgroup');
  g.label = t.commitsGroup;
  for (const c of opts.recent) g.append(option(c.hash, `${c.shortHash} · ${c.message}`));
  sel.append(g);
  // Graph'tan seçilen eski bir commit listede yoksa da gösterilsin.
  if (value && ![...sel.options].some((o) => o.value === value)) {
    const c = opts.commitOf(value);
    sel.append(option(value, c ? `${c.shortHash} · ${c.message}` : value.slice(0, 7)));
  }
  sel.value = value;
  wrap.append(lab, sel);
  return { wrap, select: sel };
}

// ---- sürerken ----

function activeView(s: BisectState, opts: BisectViewOptions): HTMLElement {
  const t = text();
  const box = h('section', 'rr-bs-card');
  const head = h('div', 'rr-bs-status');
  head.setAttribute('role', 'status');
  head.append(icon('codicon-search'), h('strong', undefined, t.running));
  const ready = s.bad !== undefined && s.goods.length > 0 && s.current !== undefined;
  if (ready) head.append(document.createTextNode(t.progress(s.steps, s.candidateCount)));
  box.append(head);

  if (!ready) {
    box.append(note('rr-bs-note', 'codicon-info', t.waiting));
  } else if (s.current) {
    box.append(h('h3', 'rr-bs-subtitle', t.testNow), commitCard(s.current, opts), h('p', 'rr-bs-hint', t.testHint));
    const marks = h('div', 'rr-bs-actions');
    marks.append(
      markButton('good', t.markGood, t.markGoodTitle, 'codicon-pass', opts),
      markButton('bad', t.markBad, t.markBadTitle, 'codicon-error', opts),
      markButton('skip', t.markSkip, t.markSkipTitle, 'codicon-debug-step-over', opts),
    );
    box.append(marks);
  }

  const finish = button(t.finish, 'rr-p-btn rr-p-btn-secondary', opts.busy, () => opts.onOp({ kind: 'bisectReset' }));
  finish.title = withCommand(t.finishTitle(s.startRef), { kind: 'bisectReset' });
  const end = h('div', 'rr-bs-actions rr-bs-end');
  end.append(finish);
  box.append(end, marksList(s, opts));
  return box;
}

function markButton(mark: 'good' | 'bad' | 'skip', label: string, title: string, ic: string, opts: BisectViewOptions): HTMLButtonElement {
  const op: GitOpRequest = { kind: 'bisectMark', mark };
  const b = button('', `rr-p-btn rr-bs-mark rr-bs-mark-${mark}`, opts.busy, () => opts.onOp(op));
  b.append(icon(ic), document.createTextNode(` ${label}`));
  b.title = withCommand(title, op);
  return b;
}

function marksList(s: BisectState, opts: BisectViewOptions): HTMLElement {
  const t = text();
  const wrap = h('section', 'rr-bs-marks');
  if (s.marks.length === 0) return wrap;
  wrap.append(h('h3', 'rr-bs-subtitle', t.marksTitle));
  const ol = h('ol', 'rr-bs-marklist');
  for (const m of [...s.marks].reverse()) {
    const li = h('li', 'rr-bs-markrow');
    const c = opts.commitOf(m.hash);
    li.append(
      h('span', `rr-bs-chip rr-bs-chip-${m.mark}`, t.markName(m.mark)),
      h('code', 'rr-bs-hash', m.hash.slice(0, 7)),
      h('span', 'rr-bs-subject', c?.message ?? m.subject ?? ''),
    );
    ol.append(li);
  }
  wrap.append(ol);
  return wrap;
}

// ---- bulununca ----

function foundView(s: BisectState, hash: string, opts: BisectViewOptions): HTMLElement {
  const t = text();
  const box = h('section', 'rr-bs-card');
  const head = h('div', 'rr-bs-status rr-bs-status-found');
  head.setAttribute('role', 'status');
  head.append(icon('codicon-bug'), h('strong', undefined, t.found));
  box.append(head, commitCard(hash, opts));

  const c = opts.commitOf(hash);
  const files = h('section', 'rr-bs-files');
  files.append(h('h3', 'rr-bs-subtitle', t.foundFiles));
  if (!c || c.files.length === 0) files.append(h('p', 'rr-bs-hint', t.noFiles));
  else {
    const ul = h('ul', 'rr-bs-filelist');
    for (const f of c.files.slice(0, 200)) {
      const li = h('li', 'rr-bs-filerow');
      const name = h('span', 'rr-bs-filename', baseName(f.path));
      name.title = f.path;
      const stat = h('span', 'rr-bs-filestat');
      stat.append(h('span', 'rr-p-add', `+${formatNumber(f.added)}`), document.createTextNode(' '), h('span', 'rr-p-del', `−${formatNumber(f.deleted)}`));
      const diff = button('Diff', 'rr-p-btn rr-p-btn-secondary rr-p-btn-small', false, () => opts.onOpenDiff(f.path, hash));
      diff.setAttribute('aria-label', `${f.path}: Diff`);
      li.append(name, stat, diff);
      ul.append(li);
    }
    files.append(ul);
  }
  box.append(files);

  const actions = h('div', 'rr-bs-actions');
  actions.append(
    button(t.showInMap, 'rr-p-btn rr-p-btn-secondary', false, () => opts.onShowInMap(hash)),
    button(t.showInGraph, 'rr-p-btn rr-p-btn-secondary', false, () => opts.onShowInGraph(hash)),
  );
  const finish = button(t.finishBack(s.startRef), 'rr-p-btn rr-p-btn-primary', opts.busy, () => opts.onOp({ kind: 'bisectReset' }));
  finish.title = withCommand(t.finishTitle(s.startRef), { kind: 'bisectReset' });
  actions.append(finish);
  box.append(actions, marksList(s, opts));
  return box;
}

// ---- ortak ----

function commitCard(hash: string, opts: BisectViewOptions): HTMLElement {
  const t = text();
  const card = h('div', 'rr-bs-commit');
  const c = opts.commitOf(hash);
  if (!c) {
    card.append(h('code', 'rr-bs-hash', t.unknownCommit(hash.slice(0, 7))));
    return card;
  }
  const top = h('div', 'rr-bs-commit-top');
  top.append(h('code', 'rr-bs-hash', c.shortHash), h('span', 'rr-bs-commit-msg', c.message));
  card.append(top, h('div', 'rr-bs-commit-meta', `${c.author} · ${formatRelative(c.date, opts.now)}`));
  return card;
}

function commandPreview(op: GitOpRequest): HTMLElement {
  const wrap = h('div', 'rr-op-cmd');
  wrap.append(h('span', 'rr-op-muted', text().commandLabel), ...opCommands(op).map((c) => h('code', 'rr-op-cmd-line', formatCommand(c))));
  return wrap;
}

function withCommand(title: string, op: GitOpRequest): string {
  return [title, ...opCommands(op).map(formatCommand)].join('\n');
}

function note(cls: string, ic: string, msg: string): HTMLElement {
  const p = h('p', `rr-bs-notebox ${cls}`);
  p.append(icon(ic), document.createTextNode(` ${msg}`));
  return p;
}

function button(label: string, cls: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function icon(name: string): HTMLSpanElement {
  const i = h('span', `codicon ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, content?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content !== undefined) e.textContent = content;
  return e;
}
