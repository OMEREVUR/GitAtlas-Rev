// "Değişiklikler" sekmesinin dosya listesi: çakışmalar / commit'e girecekler / değişenler.
// Yoğunluk VS Code Kaynak Denetimi paneli gibi: satır 22px, satır düğmeleri hover/odakta.
import './changes.css';
import type { ChangeKind, GitOpRequest, RepoOperation, WorkingFile, WorkingTreeStatus } from '../types';
import { baseName, formatNumber } from './format';
import { formatCommand, opCommands } from '../git/opCommands';

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
const KIND_TEXT: Record<ChangeKind | 'conflicted', string> = {
  modified: 'Değişti', added: 'Yeni', deleted: 'Silindi', renamed: 'Adı değişti', copied: 'Kopyalandı',
  typechange: 'Türü değişti', untracked: 'İzlenmiyor', conflicted: 'Çakışma',
};
const OP_TEXT: Record<RepoOperation, string> = {
  merge: 'Birleştirme sürüyor', rebase: 'Rebase sürüyor', cherryPick: 'Cherry-pick sürüyor', revert: 'Revert sürüyor',
};

/** Harf + Türkçe ad (treemap rozetinde de kullanılır). */
export function changeLetter(kind: ChangeKind | 'conflicted'): string {
  return KIND_LETTER[kind];
}
export function changeText(kind: ChangeKind | 'conflicted'): string {
  return KIND_TEXT[kind];
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

export function renderChanges(el: HTMLElement, opts: ChangesOptions): void {
  const { status, busy } = opts;

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
  seg.setAttribute('aria-label', 'Görünüm');
  for (const [label, tree, ic] of [['Liste', false, 'codicon-list-flat'], ['Ağaç', true, 'codicon-list-tree']] as const) {
    const b = h('button', 'rr-ch-seg-btn');
    b.type = 'button';
    b.setAttribute('aria-pressed', opts.treeView === tree ? 'true' : 'false');
    b.append(icon(ic), document.createTextNode(label));
    key(b, `view:${label}`);
    b.onclick = () => {
      if (opts.treeView !== tree) opts.onToggleTreeView();
    };
    seg.append(b);
  }
  bar.append(seg);
  const addAll = toolButton('Tümünü ekle', 'codicon-add', title("Tüm değişiklikleri commit'e ekle", cmd({ kind: 'stageAll' })), busy || changes.length === 0, () => opts.onOp({ kind: 'stageAll' }));
  key(addAll, 'tool:stageAll');
  const rmAll = toolButton('Tümünü çıkar', 'codicon-remove', title("Tümünü commit'ten çıkar (değişiklikler kaybolmaz)", cmd({ kind: 'unstageAll' })), busy || staged.length === 0, () => opts.onOp({ kind: 'unstageAll' }));
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
    msg.append(h('strong', undefined, OP_TEXT[status.operation]));
    msg.append(document.createTextNode(conflicts.length > 0
      ? ` · ${formatNumber(conflicts.length)} çakışma. Dosyaları çözüp "Çözüldü" ile işaretleyin.`
      : ' · çakışma kalmadı. Devam edebilirsiniz.'));
    text.append(msg);
    const actions = h('div', 'rr-ch-band-actions');
    const cont = h('button', 'rr-ch-btn rr-ch-btn-primary', 'Devam et');
    cont.type = 'button';
    cont.disabled = busy || conflicts.length > 0;
    cont.title = title(conflicts.length > 0 ? 'Önce tüm çakışmaları çözün' : 'İşleme devam et', cmd({ kind: 'continueOperation' }));
    cont.onclick = () => opts.onOp({ kind: 'continueOperation' });
    key(cont, 'band:continue');
    const abort = h('button', 'rr-ch-btn', 'İptal et');
    abort.type = 'button';
    abort.disabled = busy;
    abort.title = title('İşlemi iptal et ve başlamadan önceki hâline dön', cmd({ kind: 'abortOperation' }));
    abort.onclick = () => opts.onOp({ kind: 'abortOperation' });
    key(abort, 'band:abort');
    actions.append(cont, abort);
    band.append(text, actions);
    scroller.append(band);
  }

  if (conflicts.length + staged.length + changes.length === 0) {
    const empty = h('div', 'rr-ch-empty');
    empty.append(icon('codicon-check'), h('span', undefined, 'Değişiklik yok. Çalışma ağacı temiz.'));
    scroller.append(empty);
    finish();
    return;
  }

  if (conflicts.length) scroller.append(section('conflicts', 'ÇAKIŞMALAR', conflicts));
  if (staged.length) scroller.append(section('staged', "COMMIT'E GİRECEKLER", staged));
  if (changes.length) scroller.append(section('changes', 'DEĞİŞENLER', changes));
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

  function setCurrent(row: HTMLElement): void {
    el.dataset.current = row.dataset.rowkey ?? '';
    for (const r of Array.from(scroller.querySelectorAll<HTMLElement>('.rr-ch-row'))) {
      const on = r === row;
      for (const f of Array.from(r.querySelectorAll<HTMLElement>('button, input'))) f.tabIndex = on ? 0 : -1;
    }
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
        kind === 'staged' ? "Tümünü commit'ten çıkar" : "Tümünü seç (commit'e ekle)",
        () => opts.onOp(kind === 'staged' ? { kind: 'unstageAll' } : { kind: 'stageAll' }),
      );
      cb.classList.add('rr-ch-headcheck');
      cb.title = title(cb.getAttribute('aria-label') ?? '', cmd(kind === 'staged' ? { kind: 'unstageAll' } : { kind: 'stageAll' }));
      key(cb, `head:${kind}`);
      head.append(cb);
    } else {
      head.append(icon('codicon-warning'));
    }
    const h3 = h('h3', 'rr-ch-title', label);
    h3.id = headId;
    head.append(h3, h('span', 'rr-ch-count', formatNumber(entries.length)));
    sec.append(head);

    const ul = h('ul', 'rr-ch-list');
    ul.setAttribute('aria-labelledby', headId);
    if (opts.treeView) appendTree(ul, kind, entries);
    else for (const e of entries) ul.append(fileRow(e, 0, true));
    sec.append(ul);
    return sec;
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
    const walk = (f: Folder, depth: number): void => {
      for (const sub of [...f.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        // Tek alt klasörlü zincirleri birleştir ("src/git").
        let node = sub;
        let name = sub.name;
        while (node.entries.length === 0 && node.folders.size === 1) {
          const only = [...node.folders.values()][0];
          name += '/' + only.name;
          node = only;
        }
        ul.append(folderRow(kind, node, name, depth));
        walk(node, depth + 1);
      }
      for (const e of f.entries) ul.append(fileRow(e, depth, false));
    };
    walk(root, 0);
  }

  function collect(f: Folder): Entry[] {
    const out = [...f.entries];
    for (const sub of f.folders.values()) out.push(...collect(sub));
    return out;
  }

  function folderRow(kind: Section, f: Folder, name: string, depth: number): HTMLLIElement {
    const li = h('li', 'rr-ch-row rr-ch-folder');
    li.dataset.rowkey = `${kind}:dir:${f.path}`;
    li.style.setProperty('--rr-ch-depth', String(depth));
    const all = collect(f);
    const paths = all.map((e) => e.file.path);
    if (kind !== 'conflicts') {
      const partial = all.some((e) => (kind === 'staged' ? e.file.unstaged : e.file.staged) !== undefined);
      const cb = checkbox(kind === 'staged', partial, `${name} klasörü: ${kind === 'staged' ? "commit'ten çıkar" : "commit'e ekle"}`, () =>
        opts.onOp(kind === 'staged' ? { kind: 'unstage', paths } : { kind: 'stage', paths }));
      key(cb, `cb:${li.dataset.rowkey}`);
      li.append(cb);
    } else {
      li.append(h('span', 'rr-ch-checkspace'));
    }
    const main = h('button', 'rr-ch-main');
    main.type = 'button';
    key(main, `row:${li.dataset.rowkey}`);
    main.setAttribute('aria-label', `${name} klasörü, ${formatNumber(all.length)} dosya`);
    main.append(icon('codicon-folder'), h('span', 'rr-ch-name', name), h('span', 'rr-ch-dir', formatNumber(all.length)));
    // Klasör satırı yalnızca bilgi; tıklama ilk dosyayı seçer.
    main.onclick = () => {
      const first = all[0];
      if (first) opts.onSelectFile(first.file.path);
    };
    li.append(main);
    return li;
  }

  function fileRow(e: Entry, depth: number, showDir: boolean): HTMLLIElement {
    const f = e.file;
    const li = h('li', 'rr-ch-row');
    li.dataset.path = f.path;
    li.dataset.rowkey = `${e.section}:${f.path}`;
    li.style.setProperty('--rr-ch-depth', String(depth));
    if (f.path === opts.selected) li.classList.add('rr-ch-selected');
    const stagedView = e.section === 'staged';
    const rk = li.dataset.rowkey;

    if (e.section !== 'conflicts') {
      const partial = stagedView ? f.unstaged !== undefined : f.staged !== undefined;
      const cb = checkbox(stagedView, partial, stagedView ? `${baseName(f.path)}: commit'ten çıkar` : `${baseName(f.path)}: commit'e ekle`, () =>
        opts.onOp(stagedView ? { kind: 'unstage', paths: [f.path] } : { kind: 'stage', paths: [f.path] }));
      cb.title = title(stagedView ? "Commit'ten çıkar" : "Commit'e ekle", cmd(stagedView ? { kind: 'unstage', paths: [f.path] } : { kind: 'stage', paths: [f.path] }));
      key(cb, `cb:${rk}`);
      li.append(cb);
    } else {
      li.append(h('span', 'rr-ch-checkspace'));
    }

    const main = h('button', 'rr-ch-main');
    main.type = 'button';
    key(main, `row:${rk}`);
    const stat = stagedView ? f.stagedStat : e.section === 'changes' ? f.unstagedStat : f.unstagedStat ?? f.stagedStat;
    const aria = [baseName(f.path), changeText(e.kind)];
    if (dirName(f.path)) aria.push(dirName(f.path));
    if (f.oldPath) aria.push(`eski adı ${f.oldPath}`);
    if (stat) aria.push(`${formatNumber(stat.added)} eklenen, ${formatNumber(stat.deleted)} silinen satır`);
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
      done.append(icon('codicon-check'), document.createTextNode('Çözüldü'));
      done.setAttribute('aria-label', `${baseName(f.path)}: çözüldü olarak işaretle`);
      done.title = title('Çakışma çözüldü olarak işaretle', cmd({ kind: 'markResolved', paths: [f.path] }));
      done.disabled = busy;
      done.onclick = () => opts.onOp({ kind: 'markResolved', paths: [f.path] });
      key(done, `act:resolve:${rk}`);
      acts.append(done);
    } else {
      acts.append(iconButton('codicon-diff', `${baseName(f.path)}: diff'i gör`, "Diff'i gör", false, `act:diff:${rk}`, () => opts.onOpenChange(f.path, stagedView)));
    }
    if (e.kind !== 'deleted') {
      acts.append(iconButton('codicon-go-to-file', `${baseName(f.path)}: dosyayı aç`, 'Dosyayı aç', false, `act:open:${rk}`, () => opts.onOpenFile(f.path)));
    }
    if (e.section === 'changes') {
      const op: GitOpRequest = { kind: 'discard', paths: [f.path] };
      acts.append(iconButton('codicon-discard', `${baseName(f.path)}: değişikliği geri al`,
        title(e.kind === 'untracked' ? 'Geri al (dosya silinir)' : 'Değişikliği geri al', cmd(op)), busy, `act:discard:${rk}`, () => opts.onOp(op)));
    }
    li.append(acts);
    return li;
  }

  function checkbox(checked: boolean, indeterminate: boolean, label: string, onChange: () => void): HTMLInputElement {
    const cb = h('input', 'rr-ch-check');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.indeterminate = indeterminate;
    cb.disabled = busy;
    cb.setAttribute('aria-label', indeterminate ? `${label} (kısmen eklendi)` : label);
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
