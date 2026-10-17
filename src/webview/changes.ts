// "Değişiklikler" sekmesinin dosya listesi: çakışmalar / commit'e girecekler / değişenler.
// Yoğunluk VS Code Kaynak Denetimi paneli gibi: satır 22px, satır düğmeleri hover/odakta.
import './changes.css';
import type { ChangeKind, GitOpRequest, RepoOperation, WorkingFile, WorkingTreeStatus } from '../types';
import { baseName, formatNumber } from './format';
import { formatCommand, opCommands } from '../git/opCommands';
import { text } from '../i18n/changes';

export interface ChangesOptions {
  status: WorkingTreeStatus;
  busy: boolean;                         // bir işlem sürüyor → onay kutuları/düğmeler devre dışı
  treeView: boolean;                     // klasör ağacı mı düz liste mi
  selected?: string;                     // haritada/kartta seçili dosya (satır vurgusu)
  onOp: (op: GitOpRequest) => void;      // ben id üretip gitOp olarak gönderiyorum
  onOpenChange: (path: string, staged: boolean) => void;
  onOpenFile: (path: string) => void;
  onSelectFile: (path: string) => void;  // satır tıklanınca haritada da seçilsin
  onToggleTreeView: () => void;
  /** Düğme title'larında gösterilecek komut ("git add -A"). Verilmezse opCommands + formatCommand kullanılır. */
  commandFor?: (op: GitOpRequest) => string | undefined;
}

type Section = 'conflicts' | 'staged' | 'changes';

const KIND_LETTER: Record<ChangeKind | 'conflicted', string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', typechange: 'T', untracked: '?', conflicted: 'U',
};
function kindText(kind: ChangeKind | 'conflicted'): string {
  const t = text();
  const map: Record<ChangeKind | 'conflicted', string> = {
    modified: t.kindModified, added: t.kindAdded, deleted: t.kindDeleted, renamed: t.kindRenamed, copied: t.kindCopied,
    typechange: t.kindTypechange, untracked: t.kindUntracked, conflicted: t.kindConflicted,
  };
  return map[kind];
}
function opText(op: RepoOperation): string {
  const t = text();
  const map: Record<RepoOperation, string> = { merge: t.opMerge, rebase: t.opRebase, cherryPick: t.opCherryPick, revert: t.opRevert };
  return map[op];
}

/** Harf + Türkçe ad (treemap rozetinde de kullanılır). */
export function changeLetter(kind: ChangeKind | 'conflicted'): string {
  return KIND_LETTER[kind];
}
export function changeText(kind: ChangeKind | 'conflicted'): string {
  return kindText(kind);
}

interface Entry {
  file: WorkingFile;
  kind: ChangeKind | 'conflicted';
  section: Section;
}

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  entries: Entry[];
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name: string): HTMLSpanElement {
  const i = h('span', `codicon ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function title(text: string, cmd: string | undefined): string {
  return cmd ? `${text}\n${cmd}` : text;
}

/** Odak geri yüklemesi için öğeye kalıcı anahtar. */
function key(e: HTMLElement, k: string): void {
  e.dataset.key = k;
}

/** Bundan fazla dosya içeren klasör varsayılan olarak kapalı açılır. */
const COLLAPSE_OVER = 20;
/** Düz listede/klasörde ilk gösterilen satır; "daha göster" bu kadar ekler. */
const PAGE = 200;

/** el başına kalıcı görünüm durumu (yeniden render'da korunur). */
interface ViewState {
  /** `${bölüm}:${klasör}` → kullanıcının seçtiği açık/kapalı. Olmayanlar varsayılan kurala göre. */
  expanded: Map<string, boolean>;
  collapsedSections: Set<Section>;
  /** `${bölüm}` ya da `${bölüm}:${klasör}` → gösterilen dosya sayısı. */
  shown: Map<string, number>;
}
const views = new WeakMap<HTMLElement, ViewState>();

export function renderChanges(el: HTMLElement, opts: ChangesOptions): void {
  const { status, busy } = opts;
  const t = text();
  let view = views.get(el);
  if (!view) {
    view = { expanded: new Map(), collapsedSections: new Set(), shown: new Map() };
    views.set(el, view);
  }
  const vs = view;
  const rerender = (): void => renderChanges(el, opts);
  /** Roving tabindex'te Tab ile ulaşılan satır. */
  let currentRow: HTMLElement | undefined;

  // Önceki render'dan kaydırma ve odak.
  const prevScroll = el.querySelector<HTMLElement>('.rr-ch-scroll')?.scrollTop ?? 0;
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && el.contains(active) ? active.dataset.key : undefined;
  const prevCurrent = el.dataset.current;

  const conflicts: Entry[] = [];
  const staged: Entry[] = [];
  const changes: Entry[] = [];
  for (const f of status.files) {
    if (f.conflicted) {
      conflicts.push({ file: f, kind: 'conflicted', section: 'conflicts' });
      continue;
    }
    if (f.staged) staged.push({ file: f, kind: f.staged, section: 'staged' });
    if (f.unstaged) changes.push({ file: f, kind: f.unstaged, section: 'changes' });
  }
  const byPath = (a: Entry, b: Entry): number => a.file.path.localeCompare(b.file.path);
  conflicts.sort(byPath);
  staged.sort(byPath);
  changes.sort(byPath);

  el.replaceChildren();
  el.classList.add('rr-ch');
  el.classList.toggle('rr-ch-busy', busy);
  el.setAttribute('aria-busy', busy ? 'true' : 'false');

  const cmd = (op: GitOpRequest): string | undefined => {
    if (opts.commandFor) return opts.commandFor(op);
    try {
      const first = opCommands(op, status)[0];
      return first ? formatCommand(first) : undefined;
    } catch {
      return undefined;
    }
  };

  // Araç satırı
  const bar = h('div', 'rr-ch-toolbar');
  const seg = h('div', 'rr-ch-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', t.viewGroup);
  for (const [id, label, tree, ic] of [['list', t.viewList, false, 'codicon-list-flat'], ['tree', t.viewTree, true, 'codicon-list-tree']] as const) {
    const b = h('button', 'rr-ch-seg-btn');
    b.type = 'button';
    b.setAttribute('aria-pressed', opts.treeView === tree ? 'true' : 'false');
    b.append(icon(ic), document.createTextNode(label));
    key(b, `view:${id}`);
    b.onclick = () => {
      if (opts.treeView !== tree) opts.onToggleTreeView();
    };
    seg.append(b);
  }
  bar.append(seg);
  const addAll = toolButton(t.stageAllBtn, 'codicon-add', title(t.stageAllTitle, cmd({ kind: 'stageAll' })), busy || changes.length === 0, () => opts.onOp({ kind: 'stageAll' }));
  key(addAll, 'tool:stageAll');
  const rmAll = toolButton(t.unstageAllBtn, 'codicon-remove', title(t.unstageAllTitle, cmd({ kind: 'unstageAll' })), busy || staged.length === 0, () => opts.onOp({ kind: 'unstageAll' }));
  key(rmAll, 'tool:unstageAll');
  bar.append(addAll, rmAll);
  el.append(bar);

  const scroller = h('div', 'rr-ch-scroll');
  el.append(scroller);

  // Devam eden işlem bandı
  if (status.operation) {
    const band = h('div', 'rr-ch-band');
    band.setAttribute('role', 'status');
    const text = h('div', 'rr-ch-band-text');
    text.append(icon(conflicts.length > 0 ? 'codicon-warning' : 'codicon-info'));
    const msg = h('span');
    msg.append(h('strong', undefined, opText(status.operation)));
    msg.append(document.createTextNode(conflicts.length > 0 ? t.bandConflicts(conflicts.length) : t.bandNoConflicts));
    text.append(msg);
    const actions = h('div', 'rr-ch-band-actions');
    const cont = h('button', 'rr-ch-btn rr-ch-btn-primary', t.continueBtn);
    cont.type = 'button';
    cont.disabled = busy || conflicts.length > 0;
    cont.title = title(conflicts.length > 0 ? t.continueBlocked : t.continueTitle, cmd({ kind: 'continueOperation' }));
    cont.onclick = () => opts.onOp({ kind: 'continueOperation' });
    key(cont, 'band:continue');
    const abort = h('button', 'rr-ch-btn', t.abortBtn);
    abort.type = 'button';
    abort.disabled = busy;
    abort.title = title(t.abortTitle, cmd({ kind: 'abortOperation' }));
    abort.onclick = () => opts.onOp({ kind: 'abortOperation' });
    key(abort, 'band:abort');
    actions.append(cont, abort);
    band.append(text, actions);
    scroller.append(band);
  }

  if (conflicts.length + staged.length + changes.length === 0) {
    const empty = h('div', 'rr-ch-empty');
    empty.append(icon('codicon-check'), h('span', undefined, t.cleanTree));
    scroller.append(empty);
    finish();
    return;
  }

  if (conflicts.length) scroller.append(section('conflicts', t.secConflicts, conflicts));
  if (staged.length) scroller.append(section('staged', t.secStaged, staged));
  if (changes.length) scroller.append(section('changes', t.secChanges, changes));
  finish();

  // ---- yardımcılar (kapanış: opts, busy, rowsList) ----

  function finish(): void {
    scroller.scrollTop = prevScroll;
    // Roving: odak alabilecek satır (önceki, seçili ya da ilk).
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('.rr-ch-row'));
    let current = rows.find((r) => r.dataset.rowkey === prevCurrent)
      ?? rows.find((r) => r.dataset.path === opts.selected)
      ?? rows[0];
    if (current) setCurrent(current);
    if (focusKey) {
      const target = el.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`);
      if (target && !(target instanceof HTMLButtonElement && target.disabled) && !(target instanceof HTMLInputElement && target.disabled)) {
        target.focus({ preventScroll: true });
      } else if (focusKey.startsWith('row:') || focusKey.startsWith('cb:') || focusKey.startsWith('act:')) {
        // Satır kaybolduysa (ör. stage sonrası başka bölüme geçti) en yakın satıra.
        current = rows.find((r) => r.dataset.rowkey === prevCurrent) ?? rows[0];
        current?.querySelector<HTMLElement>('.rr-ch-main')?.focus({ preventScroll: true });
      }
    }
    installKeys();
  }

  function setTabbable(row: HTMLElement, on: boolean): void {
    for (const f of Array.from(row.querySelectorAll<HTMLElement>('button, input'))) f.tabIndex = on ? 0 : -1;
  }

  function setCurrent(row: HTMLElement): void {
    el.dataset.current = row.dataset.rowkey ?? '';
    if (currentRow === row) return;
    if (currentRow) setTabbable(currentRow, false);
    else for (const r of Array.from(scroller.querySelectorAll<HTMLElement>('.rr-ch-row'))) if (r !== row) setTabbable(r, false);
    setTabbable(row, true);
    currentRow = row;
  }

  function installKeys(): void {
    scroller.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const row = t.closest<HTMLElement>('.rr-ch-row');
      if (row) setCurrent(row);
    });
    el.onkeydown = (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const row = t.closest<HTMLElement>('.rr-ch-row');
      if (!row) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const rows = Array.from(scroller.querySelectorAll<HTMLElement>('.rr-ch-row'));
        const i = rows.indexOf(row);
        const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : rows.length - 1;
        const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
        if (!target) return;
        e.preventDefault();
        setCurrent(target);
        target.querySelector<HTMLElement>('.rr-ch-main')?.focus();
        target.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const main = row.querySelector<HTMLElement>('.rr-ch-main');
        const expanded = main?.getAttribute('aria-expanded');
        e.preventDefault();
        if (e.key === 'ArrowRight') {
          if (expanded === 'false') main?.click();
          else if (expanded === 'true') {
            const rows = Array.from(scroller.querySelectorAll<HTMLElement>('.rr-ch-row'));
            const next = rows[rows.indexOf(row) + 1];
            if (next && next.dataset.parent === row.dataset.rowkey) {
              setCurrent(next);
              next.querySelector<HTMLElement>('.rr-ch-main')?.focus();
            }
          }
          return;
        }
        if (expanded === 'true') {
          main?.click();
          return;
        }
        // Kapalı klasör ya da dosya: üst klasöre odak.
        const parent = row.dataset.parent ? scroller.querySelector<HTMLElement>(`.rr-ch-row[data-rowkey="${CSS.escape(row.dataset.parent)}"]`) : null;
        if (parent) {
          setCurrent(parent);
          parent.querySelector<HTMLElement>('.rr-ch-main')?.focus();
          parent.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      if (e.key === ' ' && t.classList.contains('rr-ch-main')) {
        // Space: satırın onay kutusu (Enter diff'i açar; varsayılan button davranışı).
        e.preventDefault();
        const cb = row.querySelector<HTMLInputElement>('.rr-ch-check');
        if (cb && !cb.disabled) cb.click();
      }
    };
  }

  function section(kind: Section, label: string, entries: Entry[]): HTMLElement {
    const sec = h('section', `rr-ch-section rr-ch-section-${kind}`);
    const head = h('div', 'rr-ch-head');
    const headId = `rr-ch-h-${kind}`;
    if (kind !== 'conflicts') {
      const cb = checkbox(
        kind === 'staged',
        entries.some((e) => (kind === 'staged' ? e.file.unstaged : e.file.staged) !== undefined),
        kind === 'staged' ? t.headUnstageAll : t.headStageAll,
        () => opts.onOp(kind === 'staged' ? { kind: 'unstageAll' } : { kind: 'stageAll' }),
      );
      cb.classList.add('rr-ch-headcheck');
      cb.title = title(cb.getAttribute('aria-label') ?? '', cmd(kind === 'staged' ? { kind: 'unstageAll' } : { kind: 'stageAll' }));
      key(cb, `head:${kind}`);
      head.append(cb);
    } else {
      head.append(icon('codicon-warning'));
    }
    const collapsed = vs.collapsedSections.has(kind);
    const h3 = h('h3', 'rr-ch-title');
    h3.id = headId;
    const toggle = h('button', 'rr-ch-headbtn');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.append(icon(collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'), h('span', undefined, label));
    key(toggle, `sec:${kind}`);
    toggle.onclick = () => {
      if (vs.collapsedSections.has(kind)) vs.collapsedSections.delete(kind);
      else vs.collapsedSections.add(kind);
      rerender();
    };
    h3.append(toggle);
    head.append(h3, h('span', 'rr-ch-count', formatNumber(entries.length)));
    sec.append(head);
    if (collapsed) return sec;

    const ul = h('ul', 'rr-ch-list');
    ul.setAttribute('aria-labelledby', headId);
    if (opts.treeView) appendTree(ul, kind, entries);
    else appendPaged(ul, entries, kind, 0, undefined, true);
    sec.append(ul);
    return sec;
  }

  /** Satırları PAGE'lik parçalarla ekler; fazlası için "N dosya daha göster". */
  function appendPaged(ul: HTMLElement, entries: Entry[], pageKey: string, depth: number, parent: string | undefined, showDir: boolean): void {
    const limit = vs.shown.get(pageKey) ?? PAGE;
    for (const e of entries.slice(0, limit)) ul.append(fileRow(e, depth, showDir, parent));
    const rest = entries.length - limit;
    if (rest <= 0) return;
    const li = h('li', 'rr-ch-more');
    li.style.setProperty('--rr-ch-depth', String(depth));
    const b = h('button', 'rr-ch-morebtn');
    b.type = 'button';
    const add = Math.min(rest, 500);
    b.textContent = t.showMore(add, rest);
    key(b, `more:${pageKey}`);
    b.onclick = () => {
      vs.shown.set(pageKey, limit + add);
      rerender();
    };
    li.append(b);
    ul.append(li);
  }

  function appendTree(ul: HTMLElement, kind: Section, entries: Entry[]): void {
    const root: Folder = { name: '', path: '', folders: new Map(), entries: [] };
    for (const e of entries) {
      const parts = e.file.path.split('/');
      let f = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts.slice(0, i + 1).join('/');
        let next = f.folders.get(parts[i]);
        if (!next) {
          next = { name: parts[i], path: p, folders: new Map(), entries: [] };
          f.folders.set(parts[i], next);
        }
        f = next;
      }
      f.entries.push(e);
    }
    const walk = (f: Folder, depth: number, parent: string | undefined): void => {
      for (const sub of [...f.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        // Tek alt klasörlü zincirleri birleştir ("src/git").
        let node = sub;
        let name = sub.name;
        while (node.entries.length === 0 && node.folders.size === 1) {
          const only = [...node.folders.values()][0];
          name += '/' + only.name;
          node = only;
        }
        const all = collect(node);
        const stateKey = `${kind}:${node.path}`;
        const open = vs.expanded.get(stateKey) ?? all.length <= COLLAPSE_OVER;
        const row = folderRow(kind, node, name, depth, all, open, parent);
        ul.append(row);
        if (open) walk(node, depth + 1, row.dataset.rowkey);
      }
      if (f.entries.length) appendPaged(ul, f.entries, `${kind}:${f.path}`, depth, parent, false);
    };
    walk(root, 0, undefined);
  }

  function collect(f: Folder): Entry[] {
    const out = [...f.entries];
    for (const sub of f.folders.values()) out.push(...collect(sub));
    return out;
  }

  function folderRow(kind: Section, f: Folder, name: string, depth: number, all: Entry[], open: boolean, parent: string | undefined): HTMLLIElement {
    const li = h('li', 'rr-ch-row rr-ch-folder');
    li.dataset.rowkey = `${kind}:dir:${f.path}`;
    if (parent) li.dataset.parent = parent;
    li.style.setProperty('--rr-ch-depth', String(depth));
    const paths = all.map((e) => e.file.path);
    if (kind !== 'conflicts') {
      const partial = all.some((e) => (kind === 'staged' ? e.file.unstaged : e.file.staged) !== undefined);
      const cb = checkbox(kind === 'staged', partial, kind === 'staged' ? t.folderUnstage(name) : t.folderStage(name), () =>
        opts.onOp(kind === 'staged' ? { kind: 'unstage', paths } : { kind: 'stage', paths }));
      key(cb, `cb:${li.dataset.rowkey}`);
      li.append(cb);
    } else {
      li.append(h('span', 'rr-ch-checkspace'));
    }
    const main = h('button', 'rr-ch-main');
    main.type = 'button';
    key(main, `row:${li.dataset.rowkey}`);
    // Klasörün +/− toplamı (bu bölümdeki istatistiklerden).
    let added = 0;
    let deleted = 0;
    let hasStat = false;
    for (const e of all) {
      const st = entryStat(e);
      if (st) {
        added += st.added;
        deleted += st.deleted;
        hasStat = true;
      }
    }
    const aria = [t.folderAria(name), t.fileCount(all.length)];
    if (hasStat) aria.push(t.lineStatAria(added, deleted));
    main.setAttribute('aria-label', aria.join(', '));
    main.setAttribute('aria-expanded', open ? 'true' : 'false');
    main.title = open ? t.folderClose : t.folderOpen;
    main.append(
      icon(open ? 'codicon-chevron-down' : 'codicon-chevron-right'),
      icon(open ? 'codicon-folder-opened' : 'codicon-folder'),
      h('span', 'rr-ch-name', name),
      h('span', 'rr-ch-dir', t.fileCount(all.length)),
      h('span', 'rr-ch-spacer'),
    );
    if (hasStat) {
      const st = h('span', 'rr-ch-stat');
      st.setAttribute('aria-hidden', 'true');
      st.append(h('span', 'rr-ch-add', `+${formatNumber(added)}`), h('span', 'rr-ch-del', `−${formatNumber(deleted)}`));
      main.append(st);
    }
    main.onclick = () => {
      vs.expanded.set(`${kind}:${f.path}`, !open);
      rerender();
    };
    li.append(main);
    return li;
  }

  function entryStat(e: Entry): { added: number; deleted: number } | undefined {
    const f = e.file;
    return e.section === 'staged' ? f.stagedStat : e.section === 'changes' ? f.unstagedStat : f.unstagedStat ?? f.stagedStat;
  }

  function fileRow(e: Entry, depth: number, showDir: boolean, parent?: string): HTMLLIElement {
    const f = e.file;
    const li = h('li', 'rr-ch-row');
    li.dataset.path = f.path;
    li.dataset.rowkey = `${e.section}:${f.path}`;
    if (parent) li.dataset.parent = parent;
    li.style.setProperty('--rr-ch-depth', String(depth));
    if (f.path === opts.selected) li.classList.add('rr-ch-selected');
    const stagedView = e.section === 'staged';
    const rk = li.dataset.rowkey;

    if (e.section !== 'conflicts') {
      const partial = stagedView ? f.unstaged !== undefined : f.staged !== undefined;
      const cb = checkbox(stagedView, partial, stagedView ? t.fileUnstage(baseName(f.path)) : t.fileStage(baseName(f.path)), () =>
        opts.onOp(stagedView ? { kind: 'unstage', paths: [f.path] } : { kind: 'stage', paths: [f.path] }));
      lazyTitle(cb, stagedView ? t.unstageTitle : t.stageTitle, stagedView ? { kind: 'unstage', paths: [f.path] } : { kind: 'stage', paths: [f.path] });
      key(cb, `cb:${rk}`);
      li.append(cb);
    } else {
      li.append(h('span', 'rr-ch-checkspace'));
    }

    const main = h('button', 'rr-ch-main');
    main.type = 'button';
    key(main, `row:${rk}`);
    const stat = entryStat(e);
    const aria = [baseName(f.path), changeText(e.kind)];
    if (dirName(f.path)) aria.push(dirName(f.path));
    if (f.oldPath) aria.push(t.oldName(f.oldPath));
    if (stat) aria.push(t.lineStatAria(stat.added, stat.deleted));
    main.setAttribute('aria-label', aria.join(', '));
    main.title = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;

    const letter = h('span', `rr-ch-letter rr-ch-k-${e.kind}`, changeLetter(e.kind));
    letter.setAttribute('aria-hidden', 'true');
    const name = h('span', `rr-ch-name${e.kind === 'deleted' ? ' rr-ch-deleted' : ''}`, baseName(f.path));
    main.append(icon('codicon-file'), name);
    if (f.oldPath) main.append(h('span', 'rr-ch-dir', `← ${baseName(f.oldPath)}`));
    if (showDir && dirName(f.path)) main.append(h('span', 'rr-ch-dir', dirName(f.path)));
    const spacer = h('span', 'rr-ch-spacer');
    main.append(spacer);
    if (stat) {
      const st = h('span', 'rr-ch-stat');
      st.setAttribute('aria-hidden', 'true');
      st.append(h('span', 'rr-ch-add', `+${formatNumber(stat.added)}`), h('span', 'rr-ch-del', `−${formatNumber(stat.deleted)}`));
      main.append(st);
    }
    main.append(letter);
    main.onclick = () => {
      opts.onSelectFile(f.path);
      if (e.section === 'conflicts') opts.onOpenFile(f.path);
      else opts.onOpenChange(f.path, stagedView);
    };
    li.append(main);

    const acts = h('span', 'rr-ch-actions');
    if (e.section === 'conflicts') {
      const done = h('button', 'rr-ch-btn rr-ch-resolve');
      done.type = 'button';
      done.append(icon('codicon-check'), document.createTextNode(t.resolvedBtn));
      done.setAttribute('aria-label', t.resolvedAria(baseName(f.path)));
      done.title = title(t.resolvedTitle, cmd({ kind: 'markResolved', paths: [f.path] }));
      done.disabled = busy;
      done.onclick = () => opts.onOp({ kind: 'markResolved', paths: [f.path] });
      key(done, `act:resolve:${rk}`);
      acts.append(done);
    } else {
      acts.append(iconButton('codicon-diff', t.diffAria(baseName(f.path)), t.diffTitle, false, `act:diff:${rk}`, () => opts.onOpenChange(f.path, stagedView)));
    }
    if (e.kind !== 'deleted') {
      acts.append(iconButton('codicon-go-to-file', t.openFileAria(baseName(f.path)), t.openFileTitle, false, `act:open:${rk}`, () => opts.onOpenFile(f.path)));
    }
    if (e.section === 'changes') {
      const op: GitOpRequest = { kind: 'discard', paths: [f.path] };
      const discard = iconButton('codicon-discard', t.discardAria(baseName(f.path)), '', busy, `act:discard:${rk}`, () => opts.onOp(op));
      lazyTitle(discard, e.kind === 'untracked' ? t.discardUntrackedTitle : t.discardTitle, op);
      acts.append(discard);
    }
    li.append(acts);
    return li;
  }

  /** Satır başına komut metni üzerine gelinince hesaplanır (binlerce satırda render ucuz kalsın). */
  function lazyTitle(e: HTMLElement, text: string, op: GitOpRequest): void {
    e.title = text;
    const fill = (): void => {
      e.title = title(text, cmd(op));
      e.removeEventListener('pointerenter', fill);
      e.removeEventListener('focus', fill);
    };
    e.addEventListener('pointerenter', fill);
    e.addEventListener('focus', fill);
  }

  function checkbox(checked: boolean, indeterminate: boolean, label: string, onChange: () => void): HTMLInputElement {
    const cb = h('input', 'rr-ch-check');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.indeterminate = indeterminate;
    cb.disabled = busy;
    cb.setAttribute('aria-label', indeterminate ? t.partial(label) : label);
    // Değer yerine bölüme göre karar verilir (kısmi durumda tarayıcının çevirdiği değer yanıltıcı).
    cb.onchange = () => onChange();
    return cb;
  }

  function iconButton(ic: string, aria: string, tip: string, disabled: boolean, k: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', 'rr-ch-icon');
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.title = tip;
    b.disabled = disabled;
    b.append(icon(ic));
    key(b, k);
    b.onclick = (ev) => {
      ev.stopPropagation();
      onClick();
    };
    return b;
  }

  function toolButton(label: string, ic: string, tip: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = h('button', 'rr-ch-tool');
    b.type = 'button';
    b.title = tip;
    b.disabled = disabled;
    b.append(icon(ic), document.createTextNode(label));
    b.onclick = onClick;
    return b;
  }

}
