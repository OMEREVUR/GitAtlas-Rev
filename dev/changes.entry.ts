// YALNIZCA dev önizlemesi: sahte WorkingTreeStatus ile "Değişiklikler" listesi.
// URL: ?theme=dark|light  ?width=360  ?tree=1  ?clean=1  ?merge=1  ?busy=1  ?selftest=1
import '../src/webview/base.css';
import { renderChanges } from '../src/webview/changes';
import type { GitOpRequest, WorkingFile, WorkingTreeStatus } from '../src/types';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
document.body.classList.remove('vscode-dark', 'vscode-light');
document.body.classList.add(theme);
const pageWidth = Number(params.get('width'));
if (pageWidth > 0) document.body.style.setProperty('width', `${pageWidth}px`);

const merge = params.get('merge') === '1';
const FILES: WorkingFile[] = [
  { path: 'src/webview/treemap.ts', staged: 'modified', conflicted: false, stagedStat: { added: 42, deleted: 7 } },
  { path: 'src/webview/changes.ts', staged: 'added', conflicted: false, stagedStat: { added: 380, deleted: 0 } },
  { path: 'src/git/status.ts', staged: 'modified', unstaged: 'modified', conflicted: false, stagedStat: { added: 12, deleted: 3 }, unstagedStat: { added: 4, deleted: 1 } },
  { path: 'src/model/oldCache.ts', staged: 'deleted', conflicted: false, stagedStat: { added: 0, deleted: 120 } },
  { path: 'src/panel/opsUi.ts', oldPath: 'src/panel/ops.ts', staged: 'renamed', conflicted: false, stagedStat: { added: 2, deleted: 2 } },
  { path: 'src/webview/main.ts', unstaged: 'modified', conflicted: false, unstagedStat: { added: 58, deleted: 21 } },
  { path: 'src/webview/changes.css', unstaged: 'untracked', conflicted: false, unstagedStat: { added: 240, deleted: 0 } },
  { path: 'media/icon.png', unstaged: 'modified', conflicted: false },
  { path: 'README.md', unstaged: 'modified', conflicted: false, unstagedStat: { added: 9, deleted: 2 } },
  { path: 'scripts/old-fixture.sh', unstaged: 'deleted', conflicted: false, unstagedStat: { added: 0, deleted: 44 } },
  { path: 'dev/changes.html', unstaged: 'untracked', conflicted: false, unstagedStat: { added: 30, deleted: 0 } },
  { path: 'src/git/opCommands.ts', unstaged: 'modified', conflicted: false, unstagedStat: { added: 15, deleted: 6 } },
];
const CONFLICTS: WorkingFile[] = [
  { path: 'src/extension.ts', conflicted: true, unstaged: 'modified', unstagedStat: { added: 18, deleted: 9 } },
  { path: 'package.json', conflicted: true, unstaged: 'modified', unstagedStat: { added: 3, deleted: 2 } },
];

const state = {
  status: {
    branch: merge ? 'main' : 'feat/changes',
    head: 'a3f9c21',
    upstream: 'origin/feat/changes',
    ahead: 2,
    behind: 0,
    files: params.get('clean') === '1' ? [] : merge ? [...CONFLICTS, ...FILES.slice(0, 6)] : FILES,
    operation: merge ? 'merge' : undefined,
    stashCount: 1,
  } as WorkingTreeStatus,
  tree: params.get('tree') === '1',
  busy: params.get('busy') === '1',
  selected: params.get('select') ?? 'README.md',
};

const host = document.getElementById('changes');
const logEl = document.getElementById('log');
if (!host || !logEl) throw new Error('dev/changes.html: eksik eleman');

const ops: GitOpRequest[] = [];
function log(text: string): void {
  const line = document.createElement('div');
  line.textContent = text;
  logEl!.prepend(line);
}

/** Sahte eklenti: op'u günlüğe yaz ve durumu basitçe güncelle. */
function apply(op: GitOpRequest): void {
  ops.push(op);
  log(`gitOp ${JSON.stringify(op)}`);
  const files = state.status.files;
  const stage = (f: WorkingFile): WorkingFile => (f.unstaged ? { ...f, staged: f.unstaged === 'untracked' ? 'added' : f.unstaged, unstaged: undefined, stagedStat: f.unstagedStat ?? f.stagedStat, unstagedStat: undefined } : f);
  const unstage = (f: WorkingFile): WorkingFile => (f.staged ? { ...f, unstaged: f.staged === 'added' ? 'untracked' : f.staged, staged: undefined, unstagedStat: f.stagedStat ?? f.unstagedStat, stagedStat: undefined } : f);
  if (op.kind === 'stage') state.status = { ...state.status, files: files.map((f) => (op.paths.includes(f.path) ? stage(f) : f)) };
  else if (op.kind === 'unstage') state.status = { ...state.status, files: files.map((f) => (op.paths.includes(f.path) ? unstage(f) : f)) };
  else if (op.kind === 'stageAll') state.status = { ...state.status, files: files.map((f) => (f.conflicted ? f : stage(f))) };
  else if (op.kind === 'unstageAll') state.status = { ...state.status, files: files.map(unstage) };
  else if (op.kind === 'markResolved') state.status = { ...state.status, files: files.map((f) => (op.paths.includes(f.path) ? { ...stage(f), conflicted: false } : f)) };
  render();
}

function render(): void {
  renderChanges(host!, {
    status: state.status,
    busy: state.busy,
    treeView: state.tree,
    selected: state.selected,
    onOp: apply,
    onOpenChange: (p, staged) => log(`openChange(${p}, staged=${staged})`),
    onOpenFile: (p) => log(`openFile(${p})`),
    onSelectFile: (p) => {
      state.selected = p;
      log(`select(${p})`);
    },
    onToggleTreeView: () => {
      state.tree = !state.tree;
      render();
    },
  });
}
render();

// ---- ?selftest=1: tıklama ve klavye akışı, sonuçlar günlüğe ----
function selftest(): void {
  const results: string[] = [];
  const check = (name: string, ok: boolean): void => {
    results.push(`${ok ? 'GEÇTİ' : 'KALDI'} · ${name}`);
  };
  const lastOp = (): GitOpRequest | undefined => ops[ops.length - 1];
  const row = (section: string, path: string): HTMLElement | null => host!.querySelector(`.rr-ch-section-${section} .rr-ch-row[data-path="${path}"]`);

  // 1) değişenler satırındaki kutu → stage
  const T = 'src/webview/main.ts';
  row('changes', T)?.querySelector<HTMLInputElement>('.rr-ch-check')?.click();
  const op1 = lastOp();
  check('Satır kutusu → stage', op1?.kind === 'stage' && op1.paths[0] === T);
  check('Dosya COMMIT\'E GİRECEKLER bölümüne geçti', row('staged', T) !== null);

  // 2) staged satırındaki kutu → unstage
  row('staged', T)?.querySelector<HTMLInputElement>('.rr-ch-check')?.click();
  const op2 = lastOp();
  check('Commit\'e girecekler kutusu → unstage', op2?.kind === 'unstage' && op2.paths[0] === T);

  // 3) bölüm kutuları
  host!.querySelector<HTMLInputElement>('.rr-ch-section-changes .rr-ch-headcheck')?.click();
  check('DEĞİŞENLER başlık kutusu → stageAll', lastOp()?.kind === 'stageAll');
  host!.querySelector<HTMLInputElement>('.rr-ch-section-staged .rr-ch-headcheck')?.click();
  check('COMMIT\'E GİRECEKLER başlık kutusu → unstageAll', lastOp()?.kind === 'unstageAll');

  // 4) klavye: ↓ odak, Space kutu, Enter diff
  const mains = (): HTMLElement[] => Array.from(host!.querySelectorAll<HTMLElement>('.rr-ch-section-changes .rr-ch-main'));
  const first = mains()[0];
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  check('↓ sonraki satıra odaklar', document.activeElement === mains()[1]);
  const focusedRow = (document.activeElement as HTMLElement).closest<HTMLElement>('.rr-ch-row');
  const path = focusedRow?.dataset.path;
  const before = ops.length;
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  check('Space → onay kutusu (stage)', ops.length === before + 1 && lastOp()?.kind === 'stage');
  check('Space sonrası odak korunur', document.activeElement instanceof HTMLElement && host!.contains(document.activeElement));
  void path;

  // 5) tümünü ekle düğmesinin title'ında komut
  const addAll = Array.from(host!.querySelectorAll<HTMLButtonElement>('.rr-ch-tool')).find((b) => b.textContent?.includes('Tümünü ekle'));
  check(`"Tümünü ekle" title'ında komut (${addAll?.title.split('\n')[1] ?? '—'})`, (addAll?.title ?? '').includes('git '));

  // 6) merge: Çözüldü → markResolved
  if (merge) {
    host!.querySelector<HTMLButtonElement>('.rr-ch-resolve')?.click();
    check('Çözüldü → markResolved', lastOp()?.kind === 'markResolved');
  }

  log('— selftest —');
  for (const r of results.reverse()) log(r);
}
if (params.get('selftest') === '1') selftest();
