// YALNIZCA dev önizlemesi: commit kutusu, eşitleme çubuğu, işlem bildirimi ve stash listesi.
// URL: ?lang=tr|en  ?theme=dark|light  ?width=360  ?state=clean|ahead|behind|diverged|noUpstream|detached
//      ?notice=running|ok|error|cancelled  ?amend=1  ?selftest=1
//      ?flat=1 (ikincil düğme zemini = panel zemini; kullanıcının temasındaki sorun)  ?nobranch=1 (branch düğmeleri olmadan eski görünüm)
import '../src/webview/base.css';
import '../src/webview/panel.css';
import type { GitOpKind, GitOpRequest, OpResult, StashEntry, WorkingTreeStatus } from '../src/types';
import type { WebviewToExtension } from '../src/protocol';
import { renderCommitBox, resetCommitBox } from '../src/webview/commitBox';
import { renderSyncBar } from '../src/webview/syncBar';
import { renderOpNotice, type OpNoticeState } from '../src/webview/opNotice';
import { renderStashList } from '../src/webview/stashList';
import { formatCommand, opCommands } from '../src/git/opCommands';
import { parseLang, setLang } from '../src/i18n';

const params = new URLSearchParams(location.search);
setLang(parseLang(params.get('lang')) ?? 'tr');
document.body.className = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
const width = Number(params.get('width'));
if (width > 0) {
  document.body.style.setProperty('width', `${width}px`);
  document.body.classList.add('dev-narrow');
}
const selftest = params.get('selftest') === '1';
if (params.get('flat') === '1') {
  // Bazı temalarda ikincil düğme zemini panel zemini ile aynı: kenarlık görünürlüğünü denemek için.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background');
  document.documentElement.style.setProperty('--vscode-button-secondaryBackground', bg);
  document.documentElement.style.setProperty('--vscode-sideBar-background', bg);
}

const NOW = Date.now();
const HOUR = 3600_000;

function makeStatus(kind: string): WorkingTreeStatus {
  const files: WorkingTreeStatus['files'] = [
    { path: 'src/webview/commitBox.ts', staged: 'modified', conflicted: false, stagedStat: { added: 40, deleted: 3 } },
    { path: 'src/webview/ops.css', staged: 'added', conflicted: false, stagedStat: { added: 120, deleted: 0 } },
    { path: 'README.md', unstaged: 'modified', conflicted: false, unstagedStat: { added: 2, deleted: 1 } },
    { path: 'notes.txt', unstaged: 'untracked', conflicted: false },
  ];
  const base: WorkingTreeStatus = {
    branch: 'feature/degisiklikler',
    head: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    upstream: 'origin/feature/degisiklikler',
    ahead: 0,
    behind: 0,
    files,
    stashCount: 2,
    lastCommit: {
      hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      shortHash: 'a1b2c3d',
      message: 'feat: değişiklikler sekmesi iskeleti\n\nCommit kutusu ve eşitleme çubuğu eklendi.',
      pushed: true,
    },
  };
  switch (kind) {
    case 'clean':
      return { ...base, files: [] };
    case 'behind':
      return { ...base, behind: 3 };
    case 'diverged':
      return { ...base, ahead: 2, behind: 1, lastCommit: base.lastCommit && { ...base.lastCommit, pushed: false } };
    case 'noUpstream':
      return { ...base, upstream: undefined, lastCommit: base.lastCommit && { ...base.lastCommit, pushed: false } };
    case 'detached':
      return { ...base, branch: undefined, upstream: undefined };
    default:
      return { ...base, ahead: 2, lastCommit: base.lastCommit && { ...base.lastCommit, pushed: false } };
  }
}

const STASHES: StashEntry[] = [
  { index: 0, message: 'WIP on feature/degisiklikler: yarım kalan stil denemesi', date: NOW - 2 * HOUR, branch: 'feature/degisiklikler' },
  { index: 1, message: 'On main: <b>html değil</b> düz metin', date: NOW - 50 * HOUR, branch: 'main' },
];

let status = makeStatus(params.get('state') ?? 'ahead');
let stashes = [...STASHES];
let busy = false;
let busyKind: GitOpKind | undefined;
let notice: OpNoticeState = {};
let seq = 0;

const DETAIL = [
  'To github.com:ornek/gitatlas-revrev.git',
  ' ! [rejected]        feature/degisiklikler -> feature/degisiklikler (fetch first)',
  "error: failed to push some refs to 'github.com:ornek/gitatlas-revrev.git'",
  'hint: Updates were rejected because the remote contains work that you do not',
  'hint: have locally. This is usually caused by another repository pushing to',
  'hint: the same ref. If you want to integrate the remote changes, use',
  "hint: 'git pull' before pushing again.",
  "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
  ...Array.from({ length: 10 }, (_, i) => `satır ${i + 9}: uzun çıktının kaydırıldığını göstermek için`),
].join('\n');

function result(kind: GitOpKind, ok: boolean, cancelled = false): OpResult {
  return {
    id: `dev-${++seq}`,
    kind,
    ok,
    cancelled,
    commands: ['git push'],
    message: ok
      ? '2 commit origin/feature/degisiklikler dalına gönderildi.'
      : "Gönderilemedi: uzakta sizde olmayan commit'ler var. Önce Çek ile alın, sonra yeniden gönderin.",
    detail: ok ? undefined : DETAIL,
  };
}
switch (params.get('notice')) {
  case 'running':
    notice = { running: { kind: 'push', commands: ['git push -u origin feature/degisiklikler', 'git fetch --prune'] } };
    break;
  case 'ok':
    notice = { last: result('push', true) };
    break;
  case 'error':
    notice = { last: result('push', false) };
    break;
  case 'cancelled':
    notice = { last: result('push', false, true) };
    break;
}

// ---------- sayfa ----------
const logEl = document.getElementById('log') as HTMLElement;
function log(text: string): void {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
}
const post = (msg: WebviewToExtension): void => log(`post ${JSON.stringify(msg)}`);

const syncEl = document.getElementById('sync') as HTMLElement;
const commitEl = document.getElementById('commit') as HTMLElement;
const noticeEl = document.getElementById('notice') as HTMLElement;
const stashEl = document.getElementById('stash') as HTMLElement;
const ops: GitOpRequest[] = [];

function onOp(op: GitOpRequest): void {
  ops.push(op);
  const cmds = opCommands(op, status).map(formatCommand);
  log(`onOp ${JSON.stringify(op)}  →  ${cmds.join(' && ')}`);
  if (selftest) return;
  // Sahte çalıştırma: 1,2 sn sürer; diverged durumda push hata verir.
  busy = true;
  busyKind = op.kind;
  notice = { running: { kind: op.kind, commands: cmds } };
  render();
  window.setTimeout(() => {
    busy = false;
    busyKind = undefined;
    const fail = op.kind === 'push' && status.behind > 0;
    notice = { last: { ...result(op.kind, !fail), commands: cmds, message: fail ? result(op.kind, false).message : `${cmds[0] ?? op.kind} tamamlandı.` } };
    if (op.kind === 'commit' && !fail) resetCommitBox(commitEl);
    render();
  }, 1200);
}

function render(): void {
  const branchButtons = params.get('nobranch') !== '1';
  renderSyncBar(syncEl, {
    status,
    busy,
    busyKind,
    onOp,
    onBranchMenu: branchButtons ? () => log('onBranchMenu') : undefined,
    onBranchCreate: branchButtons ? () => log('onBranchCreate') : undefined,
  });
  renderCommitBox(commitEl, { status, busy, onOp });
  renderOpNotice(noticeEl, notice, post);
  renderStashList(stashEl, stashes, { busy, onOp, canSave: status.files.length > 0 });
}
render();

if (params.get('amend') === '1') {
  const box = commitEl.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (box) {
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  }
}

// ?selftest=1: etkileşimleri simüle eder, sonuçları günlüğe yazar.
if (selftest) {
  void (async () => {
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const check = (name: string, ok: boolean): void => log(`${ok ? 'OK  ' : 'HATA'} ${name}`);
    const summary = commitEl.querySelector<HTMLInputElement>('input.rr-op-input') as HTMLInputElement;
    const body = commitEl.querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
    const chip = (t: string): HTMLButtonElement | null => commitEl.querySelector<HTMLButtonElement>(`.rr-op-chip[data-type="${t}"]`);
    const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string): void => {
      el.value = v;
      el.dispatchEvent(new Event('input'));
    };
    const lastOp = (): GitOpRequest | undefined => ops[ops.length - 1];

    type(summary, 'boş repoda çökme');
    chip('fix')?.click();
    check('tür çipi öneki ekler', summary.value === 'fix: boş repoda çökme' && chip('fix')?.getAttribute('aria-pressed') === 'true');
    chip('feat')?.click();
    check('tür çipi öneki değiştirir', summary.value === 'feat: boş repoda çökme');
    chip('')?.click();
    check('"yok" öneki kaldırır', summary.value === 'boş repoda çökme');
    type(summary, 'fix: boş repoda çökme');
    check('yazılan önek çipi seçer', chip('fix')?.getAttribute('aria-pressed') === 'true');

    summary.focus();
    summary.setSelectionRange(4, 4);
    type(body, 'Neden: status boş geliyordu.');
    summary.focus();
    summary.setSelectionRange(4, 4);
    status = { ...status, ahead: status.ahead + 1 };
    render();
    render();
    check(
      'yeniden çizimde yazı, odak ve imleç korunur',
      commitEl.querySelector('input.rr-op-input') === summary &&
        summary.value === 'fix: boş repoda çökme' &&
        body.value === 'Neden: status boş geliyordu.' &&
        document.activeElement === summary &&
        summary.selectionStart === 4,
    );

    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    const c = lastOp();
    check(
      'Ctrl+Enter = Commit (özet + boş satır + açıklama)',
      c?.kind === 'commit' && c.message === 'fix: boş repoda çökme\n\nNeden: status boş geliyordu.' && !c.amend && !c.push,
    );
    commitEl.querySelectorAll<HTMLButtonElement>('.rr-op-actions .rr-p-btn')[1]?.click();
    const cp = lastOp();
    check('Commit ve gönder → push: true', cp?.kind === 'commit' && cp.push);

    type(summary, 'x'.repeat(60));
    check('50+ karakter uyarısı', commitEl.querySelector('.rr-op-counter')?.classList.contains('is-warn') === true);
    type(summary, 'x'.repeat(80));
    check('72+ güçlü uyarı', commitEl.querySelector('.rr-op-counter')?.classList.contains('is-strong') === true);
    type(summary, 'kendi özetim');

    const amend = commitEl.querySelector<HTMLInputElement>('input[type=checkbox]') as HTMLInputElement;
    amend.checked = true;
    amend.dispatchEvent(new Event('change'));
    check('amend özeti son commit ile doldurur', summary.value === 'feat: değişiklikler sekmesi iskeleti' && body.value.startsWith('Commit kutusu'));
    amend.checked = false;
    amend.dispatchEvent(new Event('change'));
    check('amend kaldırılınca yazılan geri gelir', summary.value === 'kendi özetim');

    const before = ops.length;
    status = { ...status, files: status.files.map((f) => ({ ...f, staged: undefined })) };
    render();
    const commitBtn = commitEl.querySelector<HTMLButtonElement>('.rr-op-actions .rr-p-btn-primary') as HTMLButtonElement;
    commitBtn.click();
    check(
      'staged yoksa Commit devre dışı + açıklama',
      commitBtn.disabled && ops.length === before && (commitEl.querySelector('.rr-op-hint')?.textContent ?? '').startsWith('Önce commit'),
    );
    status = makeStatus('ahead');
    render();

    commitEl.querySelector<HTMLButtonElement>('.rr-op-last .rr-p-btn')?.click();
    check("Son commit'i geri al → undoLastCommit", lastOp()?.kind === 'undoLastCommit');

    const syncBtns = [...syncEl.querySelectorAll<HTMLButtonElement>('.rr-op-sync-btn')];
    syncBtns.forEach((b) => b.click());
    check('Getir/Çek/Gönder op\'ları', ops.slice(-3).map((o) => o.kind).join() === 'fetch,pull,push');
    check('ahead>0 → Gönder vurgulu', syncBtns[2]?.classList.contains('is-accent') === true);
    const before2 = logEl.childElementCount;
    syncEl.querySelector<HTMLButtonElement>('.rr-op-sync-ref-btn')?.click();
    syncEl.querySelector<HTMLButtonElement>('.rr-op-sync-icon')?.click();
    const lines = [...logEl.children].slice(0, logEl.childElementCount - before2).map((n) => n.textContent);
    check('branch menüsü ve Yeni branch düğmeleri', lines.includes('onBranchMenu') && lines.includes('onBranchCreate') && syncEl.querySelector('.rr-op-sync-ref-btn')?.getAttribute('aria-haspopup') === 'menu');

    stashEl.querySelector<HTMLButtonElement>('.rr-op-stash-tools .rr-p-btn')?.click();
    const sm = stashEl.querySelector<HTMLInputElement>('.rr-op-stash-form input.rr-op-input') as HTMLInputElement;
    sm.value = 'deneme';
    render();
    check('stash formu yeniden çizimde korunur', stashEl.contains(sm) && sm.value === 'deneme' && document.activeElement === sm);
    sm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const ss = lastOp();
    check('stash formu Enter → stashSave', ss?.kind === 'stashSave' && ss.message === 'deneme' && !ss.includeUntracked);
    stashEl.querySelectorAll<HTMLButtonElement>('.rr-op-stash-actions .rr-p-btn')[1]?.click();
    const sa = lastOp();
    check('Uygula ve sil → stashApply pop', sa?.kind === 'stashApply' && sa.index === 0 && sa.pop);

    resetCommitBox(commitEl);
    check('resetCommitBox alanları temizler', summary.value === '' && body.value === '');

    notice = { last: result('push', true) };
    render();
    const firstChild = noticeEl.firstElementChild;
    render();
    check('aynı sonuç yeniden çizilmez', noticeEl.firstElementChild === firstChild && !noticeEl.hidden);
    noticeEl.querySelectorAll<HTMLButtonElement>('button')[1]?.click();
    render();
    check('Kapat → gizli ve geri gelmez', noticeEl.hidden);
    notice = { last: result('push', false) };
    render();
    check('hata role=alert', noticeEl.getAttribute('role') === 'alert');
    await wait(10);
    log('selftest bitti');
  })();
}
