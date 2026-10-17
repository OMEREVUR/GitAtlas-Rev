// YALNIZCA dev önizlemesi: PULL REQUEST'LER bölümü + GitHub işlem bildirimi, sahte veriyle.
// URL: ?theme=dark|light  ?width=360
//      ?case=off|noRemote|notGitHub|connecting|error|loading|feature|default|detached|current|conflict|draft|empty
//      ?notice=running|ok  ?selftest=1
import '../src/webview/base.css';
import '../src/webview/panel.css';
import type { GitHubOpRequest, GitHubStatus, OpResult, PrDraft, PrPanelData, PullRequestDetail, WorkingTreeStatus } from '../src/types';
import type { WebviewToExtension } from '../src/protocol';
import { renderPrPanel, resetPrForm } from '../src/webview/prPanel';
import { renderOpNotice, type OpNoticeState } from '../src/webview/opNotice';

const params = new URLSearchParams(location.search);
document.body.className = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
const width = Number(params.get('width'));
if (width > 0) document.body.style.setProperty('width', `${width}px`);
const selftest = params.get('selftest') === '1';
const NOW = Date.now();
const HOUR = 3600_000;

const pr = (n: number, p: Partial<PullRequestDetail>): PullRequestDetail => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/ornek/rewiewrev/pull/${n}`,
  author: 'mert',
  headRef: `feature/pr-${n}`,
  baseRef: 'main',
  isDraft: false,
  updatedAt: NOW - n * HOUR,
  files: [],
  ci: 'success',
  body: '',
  mergeable: 'mergeable',
  reviewDecision: 'reviewRequired',
  reviewRequested: false,
  isCrossRepository: false,
  additions: 120,
  deletions: 30,
  changedFiles: 6,
  checks: [],
  ...p,
});

const CHECKS: PullRequestDetail['checks'] = [
  { name: 'build (ubuntu-latest)', state: 'success', url: 'https://github.com/ornek/rewiewrev/actions/runs/1' },
  { name: 'build (windows-latest)', state: 'success', url: 'https://github.com/ornek/rewiewrev/actions/runs/2' },
  { name: 'test', state: 'success', url: 'https://github.com/ornek/rewiewrev/actions/runs/3' },
  { name: 'lint', state: 'success' },
  { name: 'typecheck', state: 'success' },
  { name: 'e2e: Extension Development Host üzerinde çok uzun adlı bir check', state: 'success' },
  { name: 'codeql', state: 'success' },
  { name: 'dependabot', state: 'success' },
];

const MINE = [
  pr(12, { title: 'Değişiklikler sekmesi', headRef: 'feature/degisiklikler', author: 'deniz', reviewDecision: 'approved', checks: CHECKS }),
  pr(15, { title: 'Commit graph: uzun başlıkların dar panelde nasıl sarıldığını gösteren örnek', author: 'deniz', ci: 'failure', reviewDecision: 'changesRequested' }),
  pr(18, { title: 'Taslak: zaman makinesi', author: 'deniz', isDraft: true, ci: 'pending', reviewDecision: 'none' }),
];
const REVIEW = [
  pr(9, { title: 'logParser: <b>html değil</b> rename takibi', author: 'ayse', ci: 'success', reviewRequested: true }),
  pr(21, { title: 'Fork katkısı: README çevirisi', author: 'dis-katkici', isCrossRepository: true, headRef: 'patch-1', ci: 'none', reviewRequested: true, mergeable: 'conflicting' }),
];

function statusFor(branch: string | undefined, upstream?: string): WorkingTreeStatus {
  return {
    branch,
    head: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    upstream,
    ahead: 2,
    behind: 0,
    files: [],
    stashCount: 0,
  };
}

const kase = params.get('case') ?? 'feature';
let connected = !['off', 'noRemote', 'notGitHub', 'connecting'].includes(kase);
let githubStatus: GitHubStatus | undefined =
  kase === 'noRemote'
    ? { state: 'noRemote' }
    : kase === 'notGitHub'
      ? { state: 'notGitHub', remoteUrl: 'gitlab.com/ornek/rewiewrev' }
      : kase === 'connecting'
        ? { state: 'connecting' }
        : kase === 'off'
          ? { state: 'off', dismissed: false }
          : undefined;
let error: string | undefined = kase === 'error' ? 'GitHub isteği başarısız: 502 Bad Gateway. Birazdan yeniden deneyin.' : undefined;
let status: WorkingTreeStatus;
let data: PrPanelData | undefined = {
  viewer: 'deniz',
  defaultBranch: 'main',
  mergeMethods: ['merge', 'squash', 'rebase'],
  mine: kase === 'empty' ? [] : MINE,
  reviewRequested: kase === 'empty' ? [] : REVIEW,
  fetchedAt: NOW,
};
switch (kase) {
  case 'default':
    status = statusFor('main', 'origin/main');
    break;
  case 'detached':
    status = statusFor(undefined);
    break;
  case 'current':
    status = statusFor('feature/degisiklikler', 'origin/feature/degisiklikler');
    data.currentBranchPr = MINE[0];
    break;
  case 'conflict':
    status = statusFor('feature/degisiklikler', 'origin/feature/degisiklikler');
    data.currentBranchPr = pr(12, {
      title: 'Değişiklikler sekmesi',
      headRef: 'feature/degisiklikler',
      mergeable: 'conflicting',
      reviewDecision: 'changesRequested',
      ci: 'failure',
      checks: [
        { name: 'build', state: 'success' },
        { name: 'test', state: 'failure', url: 'https://github.com/ornek/rewiewrev/actions/runs/9' },
        { name: 'lint', state: 'pending' },
      ],
    });
    break;
  case 'draft':
    status = statusFor('feature/zaman', 'origin/feature/zaman');
    data.currentBranchPr = pr(18, { title: 'Taslak: zaman makinesi', headRef: 'feature/zaman', isDraft: true, ci: 'pending', reviewDecision: 'none', mergeable: 'unknown', isCrossRepository: false });
    data.mergeMethods = ['squash'];
    break;
  case 'loading':
    status = statusFor('feature/yeni');
    data = undefined;
    break;
  default:
    status = statusFor('feature/yeni');
}

let draft: PrDraft | undefined;
let draftError: string | undefined;
let busy = false;
let notice: OpNoticeState = {};
const prResult = (ok: boolean): OpResult => ({
  id: `pr-${NOW}`,
  kind: 'createPr',
  ok,
  commands: ['git push -u origin feature/yeni'],
  message: ok ? '#24 açıldı: https://github.com/ornek/rewiewrev/pull/24' : 'PR açılamadı.',
  detail: ok ? 'remote:\nremote: Create a pull request for feature/yeni on GitHub by visiting:\nremote:   https://github.com/ornek/rewiewrev/pull/new/feature/yeni' : undefined,
});
if (params.get('notice') === 'running') notice = { running: { kind: 'createPr', commands: ['git push -u origin feature/yeni'] } };
if (params.get('notice') === 'ok') notice = { last: prResult(true) };

// ---------- sayfa ----------
const logEl = document.getElementById('log') as HTMLElement;
function log(text: string): void {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
}
const post = (msg: WebviewToExtension): void => log(`post ${JSON.stringify(msg)}`);
const host = document.getElementById('pr') as HTMLElement;
const noticeEl = document.getElementById('notice') as HTMLElement;
const ops: GitHubOpRequest[] = [];
const draftCalls: Array<string | undefined> = [];

function makeDraft(base: string | undefined, variant = 0): PrDraft {
  return {
    head: status.branch ?? '',
    base: base ?? 'main',
    title: variant ? 'feat: yeni önerilen başlık' : 'feat: değişiklikler sekmesi',
    body: variant ? '- yeni gövde' : '- commit kutusu\n- eşitleme çubuğu\n- stash listesi',
    commits: 3,
    needsPush: !status.upstream,
  };
}

function render(): void {
  renderOpNotice(noticeEl, notice, post);
  renderPrPanel(host, {
    connected,
    data,
    error,
    draft,
    draftError,
    status,
    busy,
    onOp: (op) => {
      ops.push(op);
      log(`onOp ${JSON.stringify(op)}`);
    },
    onLoadDraft: (base) => {
      draftCalls.push(base);
      log(`onLoadDraft ${base ?? '(varsayılan)'}`);
      if (selftest) return;
      window.setTimeout(() => {
        draft = makeDraft(base);
        render();
      }, 300);
    },
    onOpenUrl: (url) => log(`onOpenUrl ${url}`),
    onConnect: () => {
      log('onConnect');
      connected = true;
      error = undefined;
      render();
    },
    onRefresh: () => log('onRefresh'),
    githubStatus,
    onPublish: () => log('onPublish'),
  });
}
render();

// Form açık başlasın (ekran görüntüsü için).
if (!selftest && (kase === 'feature' || kase === 'loading')) {
  host.querySelector<HTMLButtonElement>('.rr-pr-create > .rr-p-btn')?.click();
  draft = makeDraft(undefined);
  render();
}

if (selftest) {
  void (async () => {
    const check = (name: string, ok: boolean): void => log(`${ok ? 'OK  ' : 'HATA'} ${name}`);
    const lastOp = (): GitHubOpRequest | undefined => ops[ops.length - 1];
    const q = <T extends Element>(s: string): T | null => host.querySelector<T>(s);

    // 1) PR açma formu
    status = statusFor('feature/yeni');
    data = { viewer: 'deniz', defaultBranch: 'main', mergeMethods: ['merge', 'squash', 'rebase'], mine: MINE, reviewRequested: REVIEW, fetchedAt: NOW };
    render();
    q<HTMLButtonElement>('.rr-pr-create > .rr-p-btn')?.click();
    check("form açılınca onLoadDraft(undefined)", draftCalls.length === 1 && draftCalls[0] === undefined);
    draft = makeDraft(undefined);
    render();
    const title = q<HTMLInputElement>('.rr-pr-form input.rr-pr-input') as HTMLInputElement;
    const body = q<HTMLTextAreaElement>('.rr-pr-form textarea') as HTMLTextAreaElement;
    check('taslak başlık ve açıklamayı doldurur', title.value === 'feat: değişiklikler sekmesi' && body.value.startsWith('- commit kutusu'));
    check('needsPush notu', (q('.rr-pr-push')?.textContent ?? '').includes('git push -u origin feature/yeni') && !q<HTMLElement>('.rr-pr-push')?.hidden);
    title.value = 'Benim başlığım';
    title.dispatchEvent(new Event('input'));
    title.focus();
    title.setSelectionRange(3, 3);
    draft = makeDraft(undefined, 1);
    render();
    render();
    check('yeni taslak yazılan başlığı ezmez, dokunulmamış açıklamayı günceller', title.value === 'Benim başlığım' && body.value === '- yeni gövde');
    check('yeniden çizimde form, odak ve imleç korunur', q('.rr-pr-form input.rr-pr-input') === title && document.activeElement === title && title.selectionStart === 3);
    (q<HTMLInputElement>('.rr-pr-form input[type=checkbox]') as HTMLInputElement).checked = true;
    q<HTMLButtonElement>('.rr-pr-form .rr-p-btn-primary')?.click();
    const c = lastOp();
    check('PR aç → createPr', c?.kind === 'createPr' && c.title === 'Benim başlığım' && c.body === '- yeni gövde' && c.base === 'main' && c.draft);
    title.value = '';
    title.dispatchEvent(new Event('input'));
    check('başlık boşken PR aç devre dışı', q<HTMLButtonElement>('.rr-pr-form .rr-p-btn-primary')?.disabled === true);
    resetPrForm(host);
    check('resetPrForm formu kapatır', q<HTMLElement>('.rr-pr-form')?.hidden === true && title.value === '' && !q<HTMLElement>('.rr-pr-create > .rr-p-btn')?.hidden);

    // 2) varsayılan branch / ayrık HEAD
    status = statusFor('main', 'origin/main');
    render();
    check('varsayılan branch: düğme yerine açıklama', q<HTMLElement>('.rr-pr-create > .rr-p-btn')?.hidden === true && (q('.rr-pr-create > p')?.textContent ?? '').includes('varsayılan branch'));

    // 3) mevcut branch'in PR kartı
    status = statusFor('feature/degisiklikler', 'origin/feature/degisiklikler');
    data = { ...data, currentBranchPr: MINE[0] };
    render();
    const sel = q<HTMLSelectElement>('.rr-pr-merge select') as HTMLSelectElement;
    check('varsayılan yöntem squash', sel.value === 'squash');
    check('check listesi en çok 6 + "+N"', host.querySelectorAll('.rr-pr-check').length === 6 && (q('.rr-pr-more')?.textContent ?? '') === '+2 check daha');
    check('PR oluşturma bölümü gizli', q<HTMLElement>('.rr-pr-create')?.hidden === true);
    sel.value = 'merge';
    sel.dispatchEvent(new Event('change'));
    busy = true;
    render();
    busy = false;
    render();
    const sel2 = q<HTMLSelectElement>('.rr-pr-merge select') as HTMLSelectElement;
    check('yöntem seçimi yeniden çizimde korunur', sel2.value === 'merge');
    q<HTMLButtonElement>('.rr-pr-merge .rr-p-btn-primary')?.click();
    const m = lastOp();
    check('Birleştir → mergePr', m?.kind === 'mergePr' && m.number === 12 && m.method === 'merge' && m.deleteBranch);
    const mineRows = [...host.querySelectorAll('.rr-pr-list')][0]?.querySelectorAll('.rr-pr-row') ?? [];
    check('mevcut branch PR satırında Checkout yok', (mineRows[0]?.textContent ?? '').includes('Aç') && !(mineRows[0]?.textContent ?? '').includes('Checkout'));
    (mineRows[1]?.querySelector('.rr-p-btn') as HTMLButtonElement | null)?.click();
    const co = lastOp();
    check('Checkout → checkoutPr', co?.kind === 'checkoutPr' && co.number === 15);

    // 4) çakışma ve taslak
    data = { ...data, currentBranchPr: { ...(MINE[0] as PullRequestDetail), mergeable: 'conflicting' } };
    render();
    check('çakışmada Birleştir devre dışı + sebep', q<HTMLButtonElement>('.rr-pr-merge .rr-p-btn-primary')?.disabled === true && (q('.rr-pr-current')?.textContent ?? '').includes('Çakışma var!'));
    data = { ...data, currentBranchPr: { ...(MINE[0] as PullRequestDetail), isDraft: true } };
    render();
    check('taslakta Birleştir devre dışı', q<HTMLButtonElement>('.rr-pr-merge .rr-p-btn-primary')?.disabled === true);
    data = { ...data, currentBranchPr: { ...(MINE[0] as PullRequestDetail), isCrossRepository: true } };
    render();
    check("fork'ta 'Uzak branch'i sil' gizli", (q<HTMLElement>('.rr-pr-merge .rr-op-check')?.hidden ?? false) === true);

    // 5) bağlı değil
    connected = false;
    render();
    check('bağlı değilken bağlan düğmesi', (q('.rr-pr-notice')?.textContent ?? '').includes('GitHub ile bağlan'));
    githubStatus = { state: 'noRemote' };
    render();
    const pub = [...host.querySelectorAll<HTMLButtonElement>('.rr-pr-notice button')].find((b) => b.textContent === "GitHub'da yayınla");
    pub?.click();
    check("noRemote → \"GitHub'da yayınla\" → onPublish", pub !== undefined && (logEl.firstElementChild?.textContent ?? '') === 'onPublish');
    githubStatus = { state: 'notGitHub', remoteUrl: 'gitlab.com/x/y' };
    render();
    check('notGitHub → url, düğme yok', (q('.rr-pr-notice')?.textContent ?? '').includes('gitlab.com/x/y') && host.querySelectorAll('.rr-pr-notice button').length === 0);
    githubStatus = undefined;
    connected = true;

    // 6) bildirim
    notice = { running: { kind: 'createPr', commands: [] } };
    render();
    check('çalışırken "PR açılıyor…"', (noticeEl.textContent ?? '').startsWith('PR açılıyor…'));
    notice = { last: prResult(true) };
    render();
    const openBtn = [...noticeEl.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === "PR'ı aç");
    check("sonuçta GitHub adresi → \"PR'ı aç\" düğmesi", openBtn !== undefined && openBtn.title === 'https://github.com/ornek/rewiewrev/pull/24');
    log('selftest bitti');
  })();
}
