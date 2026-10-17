// "Değişiklikler" sekmesinin PULL REQUEST'LER bölümü: bu branch'ten PR açma formu, mevcut branch'in PR kartı
// (CI / review / birleştirme), "Benim PR'larım" ve "Review bekleyenler".
// İskelet ve form bir kez kurulur (yazılanlar ve odak korunur); kart ve listeler içerikleri değişince yeniden çizilir.
import './ops.css';
import './prPanel.css';
import type {
  CiState,
  GitHubOpRequest,
  MergeMethod,
  PrCheck,
  PrDraft,
  PrPanelData,
  PullRequestDetail,
  ReviewDecision,
  WorkingTreeStatus,
} from '../types';
import { CI_LABELS } from './githubBanner';
import { formatDate, formatNumber, formatRelative } from './format';
import { formatCommand, opCommands } from '../git/opCommands';

export interface PrPanelOptions {
  /** GitHub bağlı mı (status connected/stale). */
  connected: boolean;
  data: PrPanelData | undefined;
  error?: string;
  draft: PrDraft | undefined;
  draftError?: string;
  status: WorkingTreeStatus | undefined;
  busy: boolean;
  onOp: (op: GitHubOpRequest) => void;
  /** Form açılınca ve hedef branch değişince. */
  onLoadDraft: (base: string | undefined) => void;
  onOpenUrl: (url: string) => void;
  onConnect: () => void;
  onRefresh: () => void;
}

const CHECK_LIMIT = 6;
const REVIEW_LABELS: Record<ReviewDecision, string> = {
  approved: 'Onaylandı',
  changesRequested: 'Değişiklik istendi',
  reviewRequired: 'Review bekliyor',
  none: '',
};
const METHOD_LABELS: Record<MergeMethod, string> = {
  squash: 'Squash ve birleştir',
  merge: 'Merge commit',
  rebase: 'Rebase ve birleştir',
};
const CHECK_SHORT: Record<CiState, string> = { success: 'geçti', failure: 'başarısız', pending: 'sürüyor', none: 'yok' };

interface FormState {
  open: boolean;
  section: HTMLElement;
  openBtn: HTMLButtonElement;
  note: HTMLElement;
  form: HTMLElement;
  base: HTMLSelectElement;
  title: HTMLInputElement;
  body: HTMLTextAreaElement;
  draft: HTMLInputElement;
  info: HTMLElement;
  push: HTMLElement;
  error: HTMLElement;
  submit: HTMLButtonElement;
  reason: HTMLElement;
  titleTouched: boolean;
  bodyTouched: boolean;
  /** Son doldurulan taslağın anahtarı (aynı taslak alanları tekrar doldurmaz). */
  filledKey?: string;
}

interface PanelState {
  opts: PrPanelOptions;
  toggle: HTMLButtonElement;
  title: HTMLElement;
  body: HTMLElement;
  notice: HTMLElement;
  current: HTMLElement;
  form: FormState;
  mine: HTMLElement;
  review: HTMLElement;
  expanded: boolean;
  /** PR numarası → seçilen birleştirme yöntemi / uzak branch silme. */
  method: Map<number, MergeMethod>;
  deleteBranch: Map<number, boolean>;
}

const states = new WeakMap<HTMLElement, PanelState>();

export function renderPrPanel(el: HTMLElement, opts: PrPanelOptions): void {
  let st = states.get(el);
  if (!st || !el.contains(st.toggle)) st = build(el, opts);
  st.opts = opts;
  const { connected, data, error, status } = opts;

  st.toggle.setAttribute('aria-expanded', String(st.expanded));
  st.body.hidden = !st.expanded;
  const counts = connected && !error && data ? ` · ${data.mine.length + data.reviewRequested.length}` : '';
  st.title.textContent = `PULL REQUEST'LER${counts}`;

  // Bağlantı / hata / yükleniyor
  if (!connected) {
    keyed(st.notice, 'off', () => {
      const btn = button('GitHub ile bağlan', 'primary', () => st?.opts.onConnect());
      return [h('p', 'rr-pr-text', "GitHub'a bağlanınca bu branch'ten PR açabilir, PR'ları birleştirip checkout edebilirsin."), btn];
    });
  } else if (error) {
    keyed(st.notice, `err:${error}`, () => [
      h('div', 'rr-pr-error', [icon('error'), h('span', '', error)]),
      button('Yeniden dene', 'secondary', () => st?.opts.onRefresh()),
    ]);
  } else if (!data) {
    keyed(st.notice, 'loading', () => [h('p', 'rr-pr-text rr-pr-muted', "PR'lar yükleniyor…")]);
  } else {
    keyed(st.notice, '', () => []);
  }
  st.notice.hidden = st.notice.childElementCount === 0;

  const ready = connected && !error && data !== undefined;
  st.current.hidden = !ready || !data?.currentBranchPr;
  st.mine.hidden = !ready;
  st.review.hidden = !ready;
  if (!ready || !data) {
    st.form.section.hidden = true;
    return;
  }

  // Mevcut branch'in PR'ı
  const cur = data.currentBranchPr;
  if (cur) {
    keyed(st.current, JSON.stringify([cur, data.mergeMethods, opts.busy]), () => currentCard(st as PanelState, cur, data));
  }

  // PR açma
  updateForm(st, data, status);

  // Listeler
  const branch = status?.branch;
  keyed(st.mine, JSON.stringify([data.mine, branch, opts.busy]), () =>
    list(st as PanelState, `BENİM PR'LARIM (${data.mine.length})`, data.mine, 'Açık PR yok.'),
  );
  keyed(st.review, JSON.stringify([data.reviewRequested, branch, opts.busy]), () =>
    list(st as PanelState, `REVIEW BEKLEYENLER (${data.reviewRequested.length})`, data.reviewRequested, 'Review bekleyen PR yok.'),
  );
}

/** PR başarıyla açılınca formu kapatır ve temizler. */
export function resetPrForm(el: HTMLElement): void {
  const st = states.get(el);
  if (!st) return;
  const f = st.form;
  f.open = false;
  f.title.value = '';
  f.body.value = '';
  f.draft.checked = false;
  f.titleTouched = false;
  f.bodyTouched = false;
  f.filledKey = undefined;
  if (st.opts.data) updateForm(st, st.opts.data, st.opts.status);
}

// ---------- iskelet ----------
function build(el: HTMLElement, opts: PrPanelOptions): PanelState {
  el.classList.add('rr-pr');
  const uid = Math.random().toString(36).slice(2, 8);

  const chevron = icon('chevron-down', 'rr-pr-chevron');
  const title = h('span', '');
  const toggle = h('button', 'rr-pr-toggle rr-p-heading', [chevron, title]);
  toggle.type = 'button';
  const bodyId = `rr-pr-body-${uid}`;
  toggle.setAttribute('aria-controls', bodyId);
  const refresh = h('button', 'rr-p-icon-btn', [icon('refresh')]);
  refresh.type = 'button';
  refresh.setAttribute('aria-label', "PR'ları yenile");
  refresh.title = "PR'ları yenile";

  const notice = h('div', 'rr-pr-notice');
  const current = h('section', 'rr-pr-current');
  current.setAttribute('aria-label', "Bu branch'in PR'ı");
  const form = buildForm(uid);
  const mine = h('section', 'rr-pr-list-section');
  const review = h('section', 'rr-pr-list-section');
  const body = h('div', 'rr-pr-body', [notice, current, form.section, mine, review]);
  body.id = bodyId;

  el.replaceChildren(h('div', 'rr-pr-head', [toggle, refresh]), body);

  const st: PanelState = {
    opts,
    toggle,
    title,
    body,
    notice,
    current,
    form,
    mine,
    review,
    expanded: true,
    method: new Map(),
    deleteBranch: new Map(),
  };
  states.set(el, st);

  toggle.addEventListener('click', () => {
    st.expanded = !st.expanded;
    toggle.setAttribute('aria-expanded', String(st.expanded));
    body.hidden = !st.expanded;
  });
  refresh.addEventListener('click', () => st.opts.onRefresh());

  form.openBtn.addEventListener('click', () => {
    form.open = true;
    // Açılışta hedefi eklenti seçer (varsayılan branch); kullanıcı değiştirince seçilen ad gönderilir.
    st.opts.onLoadDraft(undefined);
    if (st.opts.data) updateForm(st, st.opts.data, st.opts.status);
    form.title.focus();
  });
  form.title.addEventListener('input', () => {
    form.titleTouched = form.title.value !== '';
    updateForm(st, st.opts.data, st.opts.status);
  });
  form.body.addEventListener('input', () => {
    form.bodyTouched = form.body.value !== '';
  });
  form.base.addEventListener('change', () => {
    form.filledKey = undefined;
    st.opts.onLoadDraft(form.base.value || undefined);
    updateForm(st, st.opts.data, st.opts.status);
  });
  const submit = (): void => {
    if (formBlocker(st) !== undefined) return;
    st.opts.onOp({
      kind: 'createPr',
      title: form.title.value.trim(),
      body: form.body.value.trim(),
      base: form.base.value,
      draft: form.draft.checked,
    });
  };
  form.submit.addEventListener('click', submit);
  form.form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      form.open = false;
      updateForm(st, st.opts.data, st.opts.status);
      form.openBtn.focus();
    }
  });
  const cancel = form.form.querySelector<HTMLButtonElement>('.rr-pr-cancel');
  cancel?.addEventListener('click', () => {
    form.open = false;
    updateForm(st, st.opts.data, st.opts.status);
    form.openBtn.focus();
  });
  return st;
}

function buildForm(uid: string): FormState {
  const openBtn = button("Bu branch'ten PR aç", 'secondary');
  const note = h('p', 'rr-pr-text rr-pr-muted');

  const baseId = `rr-pr-base-${uid}`;
  const base = h('select', 'rr-p-select rr-pr-select');
  base.id = baseId;
  const baseLabel = h('label', 'rr-pr-label', 'Hedef branch');
  baseLabel.htmlFor = baseId;

  const titleId = `rr-pr-title-${uid}`;
  const title = h('input', 'rr-op-input rr-pr-input');
  title.type = 'text';
  title.id = titleId;
  title.placeholder = 'PR başlığı';
  title.autocomplete = 'off';
  const titleLabel = h('label', 'rr-pr-label', 'Başlık');
  titleLabel.htmlFor = titleId;

  const bodyId = `rr-pr-desc-${uid}`;
  const body = h('textarea', 'rr-op-input rr-op-textarea rr-pr-input');
  body.id = bodyId;
  body.rows = 5;
  body.placeholder = 'Açıklama (isteğe bağlı)';
  const bodyLabel = h('label', 'rr-pr-label', 'Açıklama');
  bodyLabel.htmlFor = bodyId;

  const draft = h('input', '');
  draft.type = 'checkbox';
  const info = h('div', 'rr-pr-muted rr-pr-small');
  const push = h('div', 'rr-pr-push', [icon('info'), h('span', '')]);
  push.setAttribute('role', 'note');
  const error = h('div', 'rr-pr-error');
  error.setAttribute('role', 'alert');
  const submit = button('PR aç', 'primary');
  const cancel = button('Vazgeç', 'secondary');
  cancel.classList.add('rr-pr-cancel');
  const reason = h('div', 'rr-pr-muted rr-pr-small');
  reason.id = `rr-pr-reason-${uid}`;
  submit.setAttribute('aria-describedby', reason.id);

  const form = h('div', 'rr-pr-form', [
    h('div', 'rr-pr-field rr-pr-field-row', [baseLabel, base]),
    info,
    h('div', 'rr-pr-field', [titleLabel, title]),
    h('div', 'rr-pr-field', [bodyLabel, body]),
    h('label', 'rr-op-check', [draft, h('span', '', 'Taslak (draft) olarak aç')]),
    push,
    error,
    h('div', 'rr-op-actions', [submit, cancel]),
    reason,
  ]);
  form.setAttribute('role', 'group');
  form.setAttribute('aria-label', 'Yeni pull request');

  const section = h('section', 'rr-pr-create', [openBtn, note, form]);
  return {
    open: false,
    section,
    openBtn,
    note,
    form,
    base,
    title,
    body,
    draft,
    info,
    push,
    error,
    submit,
    reason,
    titleTouched: false,
    bodyTouched: false,
  };
}

// ---------- PR açma formu ----------
function updateForm(st: PanelState, data: PrPanelData | undefined, status: WorkingTreeStatus | undefined): void {
  const f = st.form;
  const { draft, draftError, busy } = st.opts;
  if (!data || data.currentBranchPr) {
    f.section.hidden = true;
    return;
  }
  f.section.hidden = false;
  const branch = status?.branch;
  const canCreate = branch !== undefined && branch !== data.defaultBranch;

  f.openBtn.hidden = !canCreate || f.open;
  f.form.hidden = !canCreate || !f.open;
  f.note.hidden = canCreate;
  if (!branch) f.note.textContent = "Ayrık HEAD üzerinde PR açılamaz; önce bir branch oluştur.";
  else if (!canCreate) f.note.textContent = `Şu an varsayılan branch üzerindesin: ${branch}. PR açmak için önce yeni bir branch oluştur.`;
  if (!canCreate) return;

  // Hedef branch seçenekleri: varsayılan + taslağın hedefi + mevcut seçim (aynı ad bir kez; mevcut branch hariç).
  const wanted = [data.defaultBranch, draft?.base, f.base.value].filter((b): b is string => !!b && b !== branch);
  const names = [...new Set(wanted)];
  const currentNames = [...f.base.options].map((o) => o.value);
  if (names.join('\n') !== currentNames.join('\n')) {
    const keep = f.base.value || draft?.base || data.defaultBranch;
    f.base.replaceChildren(...names.map((n) => new Option(n, n)));
    f.base.value = names.includes(keep) ? keep : (names[0] ?? '');
  }
  if (!f.base.value && names[0]) f.base.value = names[0];

  // Taslak: yalnızca bu branch ve seçili hedef için gelen taslak alanları doldurur; kullanıcının yazdığını ezmez.
  const fits = draft !== undefined && draft.head === branch && draft.base === f.base.value;
  if (fits && draft) {
    const key = `${draft.head}\u0000${draft.base}\u0000${draft.title}\u0000${draft.body}`;
    if (f.open && f.filledKey !== key) {
      if (!f.titleTouched) f.title.value = draft.title;
      if (!f.bodyTouched) f.body.value = draft.body;
      f.filledKey = key;
    }
    f.info.textContent = `${formatNumber(draft.commits)} commit · ${branch} → ${draft.base}`;
  } else {
    f.info.textContent = draftError ? '' : f.open ? 'Taslak hazırlanıyor…' : '';
  }
  f.info.hidden = !f.info.textContent;

  const needsPush = fits && draft?.needsPush === true;
  f.push.hidden = !needsPush;
  if (needsPush && status) {
    const cmd = opCommands({ kind: 'push' }, status).map(formatCommand).join(' && ');
    const span = f.push.querySelector('span:last-child');
    if (span) span.textContent = `Önce branch gönderilecek (${cmd}).`;
  }
  f.error.hidden = !draftError;
  f.error.replaceChildren(...(draftError ? [icon('error'), h('span', '', draftError)] : []));

  const reason = formBlocker(st);
  f.submit.disabled = reason !== undefined;
  f.reason.textContent = reason && !busy ? reason : '';
  f.reason.hidden = !f.reason.textContent;
}

function formBlocker(st: PanelState): string | undefined {
  const f = st.form;
  const { draft, busy, status } = st.opts;
  if (busy) return 'Bir işlem sürüyor…';
  if (!f.base.value) return 'Hedef branch seçin.';
  if (!f.title.value.trim()) return 'Bir başlık yazın.';
  if (draft && draft.head === status?.branch && draft.base === f.base.value && draft.commits === 0) {
    return 'Hedef branch ile arasında commit yok.';
  }
  return undefined;
}

// ---------- mevcut branch'in PR kartı ----------
function currentCard(st: PanelState, pr: PullRequestDetail, data: PrPanelData): HTMLElement[] {
  const { busy } = st.opts;
  const titleBtn = h('button', 'rr-pr-title-link', `#${pr.number} ${pr.title}`);
  titleBtn.type = 'button';
  titleBtn.title = "GitHub'da aç";
  titleBtn.addEventListener('click', () => st.opts.onOpenUrl(pr.url));

  const head = h('div', 'rr-pr-card-head', [icon('git-pull-request', 'rr-pr-icon'), h('div', 'rr-pr-card-titles', [titleBtn])]);
  const meta = h('div', 'rr-pr-meta', [
    h('span', 'rr-pr-refs', `${pr.headRef} → ${pr.baseRef}`),
    h('span', 'rr-p-add', `+${formatNumber(pr.additions)}`),
    h('span', 'rr-p-del', `−${formatNumber(pr.deletions)}`),
    h('span', '', `${formatNumber(pr.changedFiles)} dosya`),
  ]);
  if (pr.isDraft) meta.prepend(h('span', 'rr-p-tag', 'taslak'));
  (head.querySelector('.rr-pr-card-titles') as HTMLElement).append(meta);

  const facts = h('div', 'rr-pr-facts');
  const review = REVIEW_LABELS[pr.reviewDecision];
  if (review) facts.append(fact(reviewIcon(pr.reviewDecision), review, `is-${pr.reviewDecision}`));
  if (pr.mergeable === 'conflicting') facts.append(fact('warning', 'Çakışma var!', 'is-conflict'));
  else if (pr.mergeable === 'mergeable') facts.append(fact('check', 'Birleştirilebilir', 'is-ok'));
  else facts.append(fact('sync', 'Birleştirilebilirlik hesaplanıyor', 'is-unknown'));

  const out: HTMLElement[] = [head, facts];

  if (pr.checks.length > 0) {
    const failing = pr.checks.filter((c) => c.state === 'failure').length;
    const heading = h('h4', 'rr-pr-subheading', `CHECK'LER · ${pr.checks.length}${failing ? ` · ${failing} başarısız` : ''}`);
    const ul = h('ul', 'rr-pr-checks', pr.checks.slice(0, CHECK_LIMIT).map((c) => checkRow(st, c)));
    if (pr.checks.length > CHECK_LIMIT) {
      const more = h('button', 'rr-pr-more', `+${pr.checks.length - CHECK_LIMIT} check daha`);
      more.type = 'button';
      more.addEventListener('click', () => st.opts.onOpenUrl(`${pr.url}/checks`));
      ul.append(h('li', '', [more]));
    }
    out.push(h('div', 'rr-pr-check-block', [heading, ul]));
  } else {
    out.push(h('div', 'rr-pr-muted rr-pr-small', CI_LABELS[pr.ci]));
  }

  // Birleştir
  const methods = data.mergeMethods;
  const chosen = st.method.get(pr.number);
  const method: MergeMethod | undefined =
    chosen && methods.includes(chosen) ? chosen : methods.includes('squash') ? 'squash' : methods[0];
  const select = h('select', 'rr-p-select rr-pr-select');
  for (const m of methods) select.append(new Option(METHOD_LABELS[m], m));
  if (method) select.value = method;
  select.setAttribute('aria-label', 'Birleştirme yöntemi');
  select.disabled = busy || methods.length === 0;
  select.addEventListener('change', () => st.method.set(pr.number, select.value as MergeMethod));

  const del = h('input', '');
  del.type = 'checkbox';
  del.checked = st.deleteBranch.get(pr.number) ?? true;
  del.disabled = busy;
  del.addEventListener('change', () => st.deleteBranch.set(pr.number, del.checked));
  const delLabel = h('label', 'rr-op-check', [del, h('span', '', "Uzak branch'i sil")]);
  delLabel.hidden = pr.isCrossRepository;

  let reason: string | undefined;
  if (pr.mergeable === 'conflicting') reason = 'Çakışma var; önce çakışmaları çözüp gönderin.';
  else if (pr.isDraft) reason = "Taslak PR birleştirilemez; önce GitHub'da hazır olarak işaretleyin.";
  else if (methods.length === 0 || !method) reason = 'Bu repoda izin verilen birleştirme yöntemi yok.';
  else if (busy) reason = 'Bir işlem sürüyor…';
  const warnings: string[] = [];
  if (!reason && pr.reviewDecision === 'changesRequested') warnings.push("Değişiklik istendi; birleştirmeden önce review'ları kontrol edin.");
  if (!reason && pr.checks.some((c) => c.state === 'failure')) warnings.push("Bazı check'ler başarısız.");
  if (!reason && pr.mergeable === 'unknown') warnings.push('GitHub birleştirilebilirliği hâlâ hesaplıyor.');

  const merge = button('Birleştir', 'primary', () => {
    if (reason || !method) return;
    st.opts.onOp({ kind: 'mergePr', number: pr.number, method: select.value as MergeMethod, deleteBranch: !pr.isCrossRepository && del.checked });
  });
  merge.disabled = reason !== undefined;
  const why = h('div', `rr-pr-small ${reason ? 'rr-pr-muted' : 'rr-pr-warn-text'}`, reason ?? warnings.join(' '));
  why.id = `rr-pr-merge-why-${pr.number}`;
  why.hidden = !why.textContent;
  merge.setAttribute('aria-describedby', why.id);

  out.push(
    h('div', 'rr-pr-merge', [
      h('h4', 'rr-pr-subheading', 'BİRLEŞTİR'),
      h('div', 'rr-pr-merge-row', [select, merge]),
      delLabel,
      why,
    ]),
  );
  return out;
}

function checkRow(st: PanelState, c: PrCheck): HTMLElement {
  const dot = h('span', `rr-p-ci-dot is-${c.state}`);
  dot.setAttribute('aria-hidden', 'true');
  const label = [dot, h('span', 'rr-pr-check-name', c.name), h('span', 'rr-pr-muted', CHECK_SHORT[c.state])];
  if (c.url) {
    const url = c.url;
    const b = h('button', 'rr-pr-check rr-pr-check-link', label);
    b.type = 'button';
    b.title = `${c.name}: ${CI_LABELS[c.state]} — ayrıntıyı aç`;
    b.addEventListener('click', () => st.opts.onOpenUrl(url));
    return h('li', '', [b]);
  }
  return h('li', '', [h('span', 'rr-pr-check', label)]);
}

function fact(iconName: string, text: string, cls: string): HTMLElement {
  return h('span', `rr-pr-fact ${cls}`, [icon(iconName), h('span', '', text)]);
}

function reviewIcon(r: ReviewDecision): string {
  return r === 'approved' ? 'pass' : r === 'changesRequested' ? 'request-changes' : 'eye';
}

// ---------- listeler ----------
function list(st: PanelState, title: string, prs: readonly PullRequestDetail[], empty: string): HTMLElement[] {
  const heading = h('h4', 'rr-pr-subheading', title);
  if (prs.length === 0) return [heading, h('div', 'rr-pr-muted rr-pr-small', empty)];
  const branch = st.opts.status?.branch;
  const now = Date.now();
  const ul = h(
    'ul',
    'rr-pr-list',
    prs.map((pr) => {
      const dot = h('span', `rr-p-ci-dot is-${pr.ci}`);
      dot.setAttribute('aria-hidden', 'true');
      const meta = h('span', 'rr-pr-meta', [h('span', '', pr.author), h('span', 'rr-pr-sep', '·'), dot, h('span', '', CI_LABELS[pr.ci])]);
      const review = REVIEW_LABELS[pr.reviewDecision];
      if (review) meta.append(h('span', 'rr-pr-sep', '·'), h('span', `rr-pr-review is-${pr.reviewDecision}`, review));
      if (pr.mergeable === 'conflicting') meta.append(h('span', 'rr-pr-sep', '·'), h('span', 'rr-pr-review is-conflict', 'Çakışma var'));
      const updated = h('span', '', `güncellendi ${formatRelative(pr.updatedAt, now)}`);
      updated.title = formatDate(pr.updatedAt);
      meta.append(h('span', 'rr-pr-sep', '·'), updated);
      if (pr.isDraft) meta.append(h('span', 'rr-p-tag', 'taslak'));

      const titleEl = h('span', 'rr-p-msg rr-pr-row-title', `#${pr.number} ${pr.title}`);
      titleEl.title = `${pr.title}\n${pr.headRef} → ${pr.baseRef}`;

      const actions = h('span', 'rr-pr-row-actions');
      const onBranch = branch !== undefined && (branch === pr.headRef || branch === `pr/${pr.number}`);
      if (!onBranch) {
        const co = button('Checkout', 'secondary', () => st.opts.onOp({ kind: 'checkoutPr', number: pr.number }), true);
        co.disabled = st.opts.busy;
        co.setAttribute('aria-label', `#${pr.number} branch'ine geç (checkout)`);
        actions.append(co);
      }
      const open = button('Aç', 'secondary', () => st.opts.onOpenUrl(pr.url), true);
      open.setAttribute('aria-label', `#${pr.number} PR'ını GitHub'da aç`);
      actions.append(open);

      return h('li', 'rr-pr-row', [icon('git-pull-request', 'rr-pr-icon'), h('span', 'rr-pr-row-text', [titleEl, meta]), actions]);
    }),
  );
  return [heading, ul];
}

// ---------- yardımcılar ----------
/** İçerik anahtarı değişmediyse container'a dokunmaz (odak ve açık seçiciler korunur). */
function keyed(container: HTMLElement, key: string, make: () => HTMLElement[]): void {
  if (container.dataset.key === key && container.dataset.key !== undefined) return;
  container.dataset.key = key;
  container.replaceChildren(...make());
}

function button(label: string, kind: 'primary' | 'secondary', onClick?: () => void, small = false): HTMLButtonElement {
  const b = h('button', `rr-p-btn rr-p-btn-${kind}${small ? ' rr-p-btn-small' : ''}`, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
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

function icon(name: string, extra = ''): HTMLElement {
  const span = h('span', `codicon codicon-${name}${extra ? ` ${extra}` : ''}`);
  span.setAttribute('aria-hidden', 'true');
  return span;
}
