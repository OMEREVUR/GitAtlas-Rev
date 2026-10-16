// Graph filtre araç çubuğu: Branch / Yazar seçicileri, arama kutusu ve "Sade liste" düğmesi.
// Yeniden çağrıldığında DOM'u yeniden kurmaz; yalnızca değerleri günceller (arama kutusunun odağı korunur).
import type { GitRef } from '../types';

export interface GraphFilters {
  branch?: string;
  author?: string;
  query: string;
  plain: boolean;
}

export interface GraphToolbarOptions {
  refs: GitRef[];
  authors: string[];
  filters: GraphFilters;
  onChange: (f: GraphFilters) => void;
}

const SEARCH_DEBOUNCE_MS = 150;

interface ToolbarState {
  opts: GraphToolbarOptions;
  branch: HTMLSelectElement;
  author: HTMLSelectElement;
  search: HTMLInputElement;
  plain: HTMLButtonElement;
  branchKey: string;
  authorKey: string;
  timer: number | undefined;
}

const states = new WeakMap<HTMLElement, ToolbarState>();

export function renderGraphToolbar(el: HTMLElement, opts: GraphToolbarOptions): void {
  let st = states.get(el);
  if (!st || !el.contains(st.search)) st = build(el, opts);
  st.opts = opts;

  const branchKey = JSON.stringify(opts.refs.filter((r) => r.kind !== 'tag').map((r) => [r.kind, r.name]));
  if (branchKey !== st.branchKey) {
    fillBranches(st.branch, opts.refs);
    st.branchKey = branchKey;
  }
  const authorKey = JSON.stringify(opts.authors);
  if (authorKey !== st.authorKey) {
    fillAuthors(st.author, opts.authors);
    st.authorKey = authorKey;
  }
  setSelectValue(st.branch, opts.filters.branch);
  setSelectValue(st.author, opts.filters.author);

  // Kullanıcı yazarken (bekleyen debounce) kutunun değerine dokunma.
  if (st.timer === undefined && st.search.value !== opts.filters.query) st.search.value = opts.filters.query;

  st.plain.setAttribute('aria-pressed', String(opts.filters.plain));
}

function build(el: HTMLElement, opts: GraphToolbarOptions): ToolbarState {
  el.classList.add('rr-p-gtb');

  const branch = h('select', 'rr-p-select');
  const author = h('select', 'rr-p-select');

  const searchId = `rr-p-gsearch-${Math.random().toString(36).slice(2, 8)}`;
  const label = h('label', 'rr-visually-hidden', 'Commit, dosya ya da hash ara');
  label.htmlFor = searchId;
  const search = h('input', 'rr-p-search-input');
  search.type = 'search';
  search.id = searchId;
  search.placeholder = 'Commit, dosya, hash';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const searchIcon = h('span', 'codicon codicon-search rr-p-search-icon');
  searchIcon.setAttribute('aria-hidden', 'true');

  const plain = h('button', 'rr-p-toggle', 'Sade liste');
  plain.type = 'button';

  const row = h('div', 'rr-p-gtb-row', [
    h('label', 'rr-p-field', [h('span', 'rr-p-field-label', 'Branch'), branch]),
    h('label', 'rr-p-field', [h('span', 'rr-p-field-label', 'Yazar'), author]),
    h('div', 'rr-p-search', [searchIcon, label, search]),
    plain,
  ]);
  row.setAttribute('role', 'toolbar');
  row.setAttribute('aria-label', 'Graph filtreleri');
  el.replaceChildren(row);

  const st: ToolbarState = { opts, branch, author, search, plain, branchKey: '', authorKey: '', timer: undefined };
  states.set(el, st);

  const emit = (patch: Partial<GraphFilters>): void => st.opts.onChange({ ...st.opts.filters, ...patch });
  const cancelPending = (): void => {
    if (st.timer !== undefined) window.clearTimeout(st.timer);
    st.timer = undefined;
  };

  branch.addEventListener('change', () => emit({ branch: branch.value || undefined }));
  author.addEventListener('change', () => emit({ author: author.value || undefined }));
  search.addEventListener('input', () => {
    cancelPending();
    st.timer = window.setTimeout(() => {
      st.timer = undefined;
      if (search.value !== st.opts.filters.query) emit({ query: search.value });
    }, SEARCH_DEBOUNCE_MS);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || search.value === '') return;
    e.preventDefault();
    e.stopPropagation();
    cancelPending();
    search.value = '';
    emit({ query: '' });
  });
  plain.addEventListener('click', () => emit({ plain: !st.opts.filters.plain }));
  return st;
}

function fillBranches(select: HTMLSelectElement, refs: readonly GitRef[]): void {
  const byName = (a: GitRef, b: GitRef): number => a.name.localeCompare(b.name);
  const local = refs.filter((r) => r.kind === 'local').sort(byName);
  const remote = refs.filter((r) => r.kind === 'remote').sort(byName);
  const nodes: Array<HTMLOptionElement | HTMLOptGroupElement> = [new Option('Tümü', '')];
  for (const [label, list] of [
    ['Lokal', local],
    ['Remote', remote],
  ] as const) {
    if (list.length === 0) continue;
    const group = h('optgroup', '');
    group.label = label;
    group.append(...list.map((r) => new Option(r.name, r.name)));
    nodes.push(group);
  }
  select.replaceChildren(...nodes);
}

function fillAuthors(select: HTMLSelectElement, authors: readonly string[]): void {
  select.replaceChildren(new Option('Herkes', ''), ...authors.map((a) => new Option(a, a)));
}

/** Listede olmayan bir değer seçiliyse (ör. silinmiş branch) onu da gösterir, sessizce "Tümü"ye düşmez. */
function setSelectValue(select: HTMLSelectElement, value: string | undefined): void {
  const v = value ?? '';
  if (v && ![...select.options].some((o) => o.value === v)) select.append(new Option(v, v));
  if (select.value !== v) select.value = v;
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
