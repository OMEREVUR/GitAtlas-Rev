import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_KEYS, getDefaultRange, getGitPath, getGraphPageSize, getIgnoreGlobs, getPullStrategy } from '../config';
import { countPrsByFile, type HeatDecorationProvider } from '../decorations/heatDecorations';
import { GitError, runGit, setGitPath } from '../git/gitRunner';
import { listRefs } from '../git/refs';
import { getStatus, listStashes } from '../git/status';
import type { GitHubLayer } from '../github/githubLayer';
import { computeFileStats } from '../model/aggregate';
import { computeContrib } from '../model/contrib';
import { loadGraph } from '../model/graphService';
import { loadSnapshot, NoCommitsError } from '../model/repoService';
import { getLang } from '../i18n';
import { panelText } from '../i18n/panel';
import { buildTimeline } from '../model/timeline';
import { fetchPrPanel } from '../github/prApi';
import { GitHubOpsService } from '../ops/githubOpsService';
import { GitOpsService } from '../ops/gitOpsService';
import { computePrDraft } from '../ops/prDraft';
import { OpQueue } from '../ops/opQueue';
import type { ErrorCode, ExtensionToWebview, StateAction, WebviewToExtension } from '../protocol';
import type {
  FileStat,
  GitHubData,
  GitHubOpKind,
  GitHubStatus,
  GitHubOpRequest,
  GitOpKind,
  GitOpRequest,
  GitRef,
  GraphData,
  MergeMethod,
  OpResult,
  PrPanelData,
  PullRequest,
  PullRequestDetail,
  PullStrategy,
  RepoSnapshot,
  StashEntry,
  TimeRange,
  WorkingTreeStatus,
} from '../types';
import { INDEX_REF, makeGitUri } from './gitContentProvider';
import { createVscodeOpsUi } from './opsUi';
import type { RepoManager } from './repoManager';
import { WorkingTreeWatcher } from './workingTreeWatcher';
import type { GitAtlasRevRevStatusBar } from './statusBar';

const RANGES: readonly TimeRange[] = ['7d', '30d', 'all'];
const ACTIONS: readonly StateAction[] = ['openFolder', 'initRepo', 'openScm', 'openGitPathSetting', 'downloadGit'];
const MAX_COMMITS = 1000;
const MAX_GRAPH_LIMIT = 20000;

function isRange(v: unknown): v is TimeRange {
  return typeof v === 'string' && (RANGES as readonly string[]).includes(v);
}

function isAction(v: unknown): v is StateAction {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v);
}

/** Repo köküne göre, "/" ayraçlı, kökten dışarı çıkmayan göreli yol mu? */
export function isSafeRelPath(v: unknown): v is string {
  if (typeof v !== 'string' || v === '') return false;
  if (v.startsWith('/') || v.includes('\\') || /^[a-zA-Z]:/.test(v)) return false;
  return v.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Git ref adı gibi görünüyor mu? ('-' ile başlamaz; boşluk, kontrol karakteri, '..' ve git'in yasakladığı karakterler yok.) */
export function isSafeRefName(v: unknown): v is string {
  if (typeof v !== 'string' || v === '' || v.length > 255) return false;
  if (v.startsWith('-') || v.startsWith('/') || v.endsWith('/') || v.endsWith('.') || v.endsWith('.lock')) return false;
  if (v.includes('..') || v.includes('//') || v.includes('@{')) return false;
  return !/[\s\x00-\x1f\x7f~^:?*[\\]/.test(v);
}

/** Yalnızca https://github.com/… adresleri (kullanıcı adı/parola/port yok). */
export function isGitHubUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048 || !v.startsWith('https://github.com/')) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.hostname === 'github.com' && u.port === '' && u.username === '' && u.password === '';
}

const OP_KINDS: readonly GitOpKind[] = [
  'stage', 'stageAll', 'unstage', 'unstageAll', 'discard', 'commit', 'undoLastCommit', 'fetch', 'pull', 'push',
  'checkout', 'createBranch', 'mergeBranch', 'renameBranch', 'deleteBranch', 'stashSave', 'stashApply', 'stashDrop',
  'markResolved', 'continueOperation', 'abortOperation',
];
const PULL_STRATEGIES: readonly PullStrategy[] = ['ff', 'merge', 'rebase'];
const MAX_OP_PATHS = 10000;
const MAX_MESSAGE = 10000;
const MAX_STASH_INDEX = 100000;

function isPathList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.length <= MAX_OP_PATHS && (v as unknown[]).every(isSafeRelPath);
}

function isStashIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_STASH_INDEX;
}

function isOptionalBool(v: unknown): v is boolean | undefined {
  return v === undefined || typeof v === 'boolean';
}

/** Webview'dan gelen git işlemini doğrular; bozuksa undefined. */
export function parseGitOp(raw: unknown): GitOpRequest | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !(OP_KINDS as readonly string[]).includes(o.kind)) return undefined;
  switch (o.kind as GitOpKind) {
    case 'stage':
    case 'unstage':
    case 'discard':
    case 'markResolved':
      return isPathList(o.paths) ? { kind: o.kind as 'stage', paths: [...o.paths] } : undefined;
    case 'stageAll':
    case 'unstageAll':
    case 'undoLastCommit':
    case 'fetch':
    case 'continueOperation':
    case 'abortOperation':
      return { kind: o.kind as 'fetch' };
    case 'commit':
      return typeof o.message === 'string' && o.message.length <= MAX_MESSAGE && typeof o.amend === 'boolean' && typeof o.push === 'boolean'
        ? { kind: 'commit', message: o.message, amend: o.amend, push: o.push }
        : undefined;
    case 'pull':
      if (o.strategy === undefined) return { kind: 'pull' };
      return typeof o.strategy === 'string' && (PULL_STRATEGIES as readonly string[]).includes(o.strategy)
        ? { kind: 'pull', strategy: o.strategy as PullStrategy }
        : undefined;
    case 'push':
      if (!isOptionalBool(o.force)) return undefined;
      return o.force === undefined ? { kind: 'push' } : { kind: 'push', force: o.force };
    case 'checkout':
      return isSafeRefName(o.branch) ? { kind: 'checkout', branch: o.branch } : undefined;
    case 'mergeBranch':
      return isSafeRefName(o.branch) ? { kind: 'mergeBranch', branch: o.branch } : undefined;
    case 'createBranch': {
      if (!isSafeRefName(o.name) || typeof o.checkout !== 'boolean') return undefined;
      if (o.from === undefined) return { kind: 'createBranch', name: o.name, checkout: o.checkout };
      return isSafeRefName(o.from) ? { kind: 'createBranch', name: o.name, from: o.from, checkout: o.checkout } : undefined;
    }
    case 'renameBranch':
      return isSafeRefName(o.from) && isSafeRefName(o.to) ? { kind: 'renameBranch', from: o.from, to: o.to } : undefined;
    case 'deleteBranch':
      return isSafeRefName(o.name) ? { kind: 'deleteBranch', name: o.name } : undefined;
    case 'stashSave': {
      if (typeof o.includeUntracked !== 'boolean') return undefined;
      if (o.message === undefined) return { kind: 'stashSave', includeUntracked: o.includeUntracked };
      return typeof o.message === 'string' && o.message.length <= MAX_MESSAGE
        ? { kind: 'stashSave', message: o.message, includeUntracked: o.includeUntracked }
        : undefined;
    }
    case 'stashApply':
      return isStashIndex(o.index) && typeof o.pop === 'boolean' ? { kind: 'stashApply', index: o.index, pop: o.pop } : undefined;
    case 'stashDrop':
      return isStashIndex(o.index) ? { kind: 'stashDrop', index: o.index } : undefined;
  }
}

const MERGE_METHODS: readonly MergeMethod[] = ['merge', 'squash', 'rebase'];
const MAX_PR_TITLE = 256;
const MAX_PR_BODY = 65536;

function isPrNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 1e9;
}

/** Webview'dan gelen GitHub işlemini doğrular; bozuksa undefined. */
export function parseGitHubOp(raw: unknown): GitHubOpRequest | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case 'createPr':
      return typeof o.title === 'string' &&
        o.title.trim().length >= 1 &&
        o.title.length <= MAX_PR_TITLE &&
        typeof o.body === 'string' &&
        o.body.length <= MAX_PR_BODY &&
        isSafeRefName(o.base) &&
        typeof o.draft === 'boolean'
        ? { kind: 'createPr', title: o.title, body: o.body, base: o.base, draft: o.draft }
        : undefined;
    case 'mergePr':
      return isPrNumber(o.number) &&
        typeof o.method === 'string' &&
        (MERGE_METHODS as readonly string[]).includes(o.method) &&
        typeof o.deleteBranch === 'boolean'
        ? { kind: 'mergePr', number: o.number, method: o.method as MergeMethod, deleteBranch: o.deleteBranch }
        : undefined;
    case 'checkoutPr':
      return isPrNumber(o.number) ? { kind: 'checkoutPr', number: o.number } : undefined;
    default:
      return undefined;
  }
}

/** Temel PR bilgisinden (GitHub katmanının listesi) ayrıntı; bilinmeyen alanlar nötr değerle. */
export function detailFromBasic(pr: PullRequest): PullRequestDetail {
  return {
    ...pr,
    body: '',
    mergeable: 'unknown',
    reviewDecision: 'none',
    reviewRequested: false,
    isCrossRepository: false,
    additions: 0,
    deletions: 0,
    changedFiles: pr.files.length,
    checks: [],
  };
}

/** PR numarasından ayrıntı: önce PR paneli verisi (mevcut branch, benim, review istenen), yoksa temel liste. */
export function findPrDetail(
  number: number,
  panel: PrPanelData | undefined,
  basic: readonly PullRequest[],
): PullRequestDetail | undefined {
  if (panel) {
    const all = [...(panel.currentBranchPr ? [panel.currentBranchPr] : []), ...panel.mine, ...panel.reviewRequested];
    const hit = all.find((p) => p.number === number);
    if (hit) return hit;
  }
  const b = basic.find((p) => p.number === number);
  return b ? detailFromBasic(b) : undefined;
}

export type GitHubConnectAction = 'disabled' | 'publish-prompt' | 'not-github' | 'connect';

/** "GitHub ile bağlan" isteğinde ne yapılacağı: ayar kapalı / origin yok / origin GitHub değil / bağlan. */
export function githubConnectAction(status: GitHubStatus, enabled: boolean): GitHubConnectAction {
  if (!enabled) return 'disabled';
  if (status.state === 'noRemote') return 'publish-prompt';
  if (status.state === 'notGitHub') return 'not-github';
  return 'connect';
}

/** Remote'un yeniden algılanması gereken durumlar (origin sonradan eklenmiş/değişmiş olabilir). */
export function needsRemoteRedetect(status: GitHubStatus): boolean {
  return status.state === 'noRemote' || status.state === 'notGitHub' || status.state === 'off';
}

/** Başarılı olunca HEAD/ref'leri (ve dolayısıyla harita/graph/branch'leri) değiştiren işlemler. */
export function opChangesRefs(kind: GitOpKind): boolean {
  switch (kind) {
    case 'commit':
    case 'undoLastCommit':
    case 'fetch':
    case 'pull':
    case 'push':
    case 'checkout':
    case 'createBranch':
    case 'mergeBranch':
    case 'renameBranch':
    case 'deleteBranch':
    case 'stashApply':
    case 'continueOperation':
    case 'abortOperation':
      return true;
    default:
      return false;
  }
}

/** Çıktı kanalına yazılacak satırdan gizli bilgileri siler (bilinen token'lar, URL'deki kimlik bilgisi, gh*_ token'ları). */
export function redactSecrets(line: string, secrets: readonly string[] = []): string {
  let out = line;
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('***');
  return out
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1***@')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '***')
    .replace(/(authorization:\s*(?:bearer|basic|token)\s+)\S+/gi, '$1***');
}

/** Webview'dan gelen veriyi doğrular; tanınmayan/bozuk mesajda undefined. */
export function parseWebviewMessage(raw: unknown): WebviewToExtension | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'refresh':
      return { type: 'refresh' };
    case 'setRange':
      return isRange(m.range) ? { type: 'setRange', range: m.range } : undefined;
    case 'openFile':
      return isSafeRelPath(m.path) ? { type: 'openFile', path: m.path } : undefined;
    case 'openDiff':
      return isSafeRelPath(m.path) && typeof m.hash === 'string' && /^[0-9a-f]{4,64}$/i.test(m.hash)
        ? { type: 'openDiff', path: m.path, hash: m.hash }
        : undefined;
    case 'command':
      return isAction(m.action) ? { type: 'command', action: m.action } : undefined;
    case 'loadGraph': {
      const { limit, branch } = m;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_GRAPH_LIMIT) return undefined;
      if (branch === undefined) return { type: 'loadGraph', limit };
      return isSafeRefName(branch) ? { type: 'loadGraph', branch, limit } : undefined;
    }
    case 'githubConnect':
      return { type: 'githubConnect' };
    case 'githubPublish':
      return { type: 'githubPublish' };
    case 'branchMenu':
      return { type: 'branchMenu' };
    case 'branchCreate':
      return { type: 'branchCreate' };
    case 'repoMenu':
      return { type: 'repoMenu' };
    case 'githubDismiss':
      return { type: 'githubDismiss' };
    case 'githubRefresh':
      return { type: 'githubRefresh' };
    case 'openUrl':
      return isGitHubUrl(m.url) ? { type: 'openUrl', url: m.url } : undefined;
    case 'loadTimeline':
      return { type: 'loadTimeline' };
    case 'loadContrib':
      return isRange(m.range) ? { type: 'loadContrib', range: m.range } : undefined;
    case 'loadStatus':
      return { type: 'loadStatus' };
    case 'gitOp': {
      if (typeof m.id !== 'string' || m.id === '' || m.id.length > 64) return undefined;
      const op = parseGitOp(m.op);
      return op ? { type: 'gitOp', id: m.id, op } : undefined;
    }
    case 'openChange':
      return isSafeRelPath(m.path) && typeof m.staged === 'boolean' ? { type: 'openChange', path: m.path, staged: m.staged } : undefined;
    case 'showOutput':
      return { type: 'showOutput' };
    case 'loadPrPanel':
      return { type: 'loadPrPanel' };
    case 'loadPrDraft':
      if (m.base === undefined) return { type: 'loadPrDraft' };
      return isSafeRefName(m.base) ? { type: 'loadPrDraft', base: m.base } : undefined;
    case 'githubOp': {
      if (typeof m.id !== 'string' || m.id === '' || m.id.length > 64) return undefined;
      const op = parseGitHubOp(m.op);
      return op ? { type: 'githubOp', id: m.id, op } : undefined;
    }
    default:
      return undefined;
  }
}

/** Hata → panel durum kodu + kısa durum çubuğu metni. */
export function mapError(err: unknown): { code: ErrorCode; message: string; short: string } {
  const t = panelText();
  if (err instanceof GitError) {
    if (err.code === 'notFound') return { code: 'noGit', message: err.message, short: t.errNoGitShort };
    if (err.code === 'notRepo') return { code: 'noRepo', message: err.message, short: t.errNoRepoShort };
  }
  if (err instanceof NoCommitsError) {
    return { code: 'noCommits', message: err.message || t.errNoCommits, short: t.errNoCommitsShort };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'unknown', message, short: t.errScanFailedShort };
}

class NoWorkspaceError extends Error {}

export class GitAtlasRevRevPanelProvider implements vscode.WebviewViewProvider, vscode.WebviewPanelSerializer, vscode.Disposable {
  static readonly viewType = 'gitatlas-revrev.panel';
  /** Düzenleyici alanındaki sekme ("GitAtlas-Rev: Harita"). */
  static readonly editorViewType = 'gitatlas-revrev.editor';

  private readonly rootEmitter = new vscode.EventEmitter<string>();
  readonly onDidResolveRoot: vscode.Event<string> = this.rootEmitter.event;

  private readonly refsEmitter = new vscode.EventEmitter<GitRef[] | undefined>();
  /** Her reload'da (ve refreshRefs'te) listRefs sonucu; hata/repo yoksa undefined. */
  readonly onDidLoadRefs: vscode.Event<GitRef[] | undefined> = this.refsEmitter.event;

  private readonly branchActionEmitter = new vscode.EventEmitter<'menu' | 'create'>();
  /** Webview'daki branch düğmeleri (menü / yeni branch); QuickPick'i extension.ts gösterir. */
  readonly onDidRequestBranchAction: vscode.Event<'menu' | 'create'> = this.branchActionEmitter.event;

  /** .git/config izleyicisi: origin eklenince/değişince GitHub katmanı remote'u yeniden algılar. */
  private gitConfigWatcher: vscode.Disposable | undefined;

  /** Açık webview'lar (yan panel ve/veya düzenleyici sekmesi); hepsi aynı modeli alır. */
  private readonly webviews = new Map<vscode.Webview, { disposables: vscode.Disposable[]; isVisible: () => boolean }>();
  /** github.setVisible'a en son verilen değer. */
  private anyVisible = false;
  private editorPanel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private root: string | undefined;
  private snapshot: RepoSnapshot | undefined;
  private range: TimeRange = getDefaultRange();
  /** Son publishModel'de hesaplanan dosyalar (rozetleri ayar/GitHub değişince yeniden kurmak için). */
  private files: FileStat[] = [];
  /** Son listRefs sonucu (zaman makinesindeki etiket işaretleri için). */
  private refs: GitRef[] | undefined;

  /** v4: istendiyse her reload'da yeniden üretilir. */
  private timelineRequested = false;
  private contribRange: TimeRange | undefined;
  private lastTimeline: ExtensionToWebview | undefined;
  private lastContrib: ExtensionToWebview | undefined;
  /** Webview'a gönderilen son durum (model/loading/error); `ready` gelince yeniden gönderilir. */
  private lastState: ExtensionToWebview | undefined;

  /** Son istenen graph parametreleri (reload'da aynısıyla yeniden yüklenir). */
  private graphParams: { limit: number; branch?: string } | undefined;
  private graph: GraphData | undefined;
  /** Son graph durumu (graphLoading/graph/graphError); `ready` gelince yeniden gönderilir. */
  private lastGraphState: ExtensionToWebview | undefined;
  private graphRunning: Promise<void> | undefined;
  private graphRerun = false;
  private selectedBranch: string | undefined;

  /** v5: çalışma ağacı durumu (loadStatus geldikten sonra izlenir). */
  private statusRequested = false;
  private watcher: WorkingTreeWatcher | undefined;
  private lastStatus: WorkingTreeStatus | undefined;
  private lastStashes: StashEntry[] | undefined;
  private statusRunning: Promise<void> | undefined;
  private statusRerun = false;
  /** Tüm yazma işlemleri tek kuyrukta (kök değişse bile). */
  private readonly opQueue = new OpQueue();
  private ops: { root: string; service: GitOpsService } | undefined;
  private githubOps: { root: string; service: GitHubOpsService } | undefined;
  /** v5 2. tur: PR paneli (loadPrPanel geldikten sonra güncel tutulur). */
  private prPanelRequested = false;
  private lastPrPanel: PrPanelData | undefined;
  private lastPrPanelMsg: ExtensionToWebview | undefined;
  private prPanelRunning: Promise<void> | undefined;
  private prPanelRerun = false;
  private opCounter = 0;
  /** Bu oturumda alınan token'lar; çıktı kanalında maskelenir. */
  private readonly secrets = new Set<string>();
  private readonly output = vscode.window.createOutputChannel('GitAtlas-Rev Git');

  private running: Promise<void> | undefined;
  private rerun = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storageDir: string,
    private readonly decorations: HeatDecorationProvider,
    private readonly statusBar: GitAtlasRevRevStatusBar,
    private readonly github: GitHubLayer,
    private readonly repos: RepoManager,
  ) {
    setGitPath(getGitPath());
    this.statusBar.setGitHub(github.data);
    this.disposables.push(
      this.rootEmitter,
      this.refsEmitter,
      this.branchActionEmitter,
      { dispose: () => this.gitConfigWatcher?.dispose() },
      this.output,
      { dispose: () => this.watcher?.dispose() },
      github.onDidChange((data) => this.onGitHubChange(data)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_KEYS.gitPath) || e.affectsConfiguration(CONFIG_KEYS.vscodeGitPath)) {
          setGitPath(getGitPath());
          void this.reload();
          return;
        }
        if (e.affectsConfiguration(CONFIG_KEYS.defaultRange)) this.range = getDefaultRange();
        if (
          e.affectsConfiguration(CONFIG_KEYS.ignore) ||
          e.affectsConfiguration(CONFIG_KEYS.defaultRange) ||
          e.affectsConfiguration(CONFIG_KEYS.graphPageSize)
        ) {
          this.recompute();
        } else if (e.affectsConfiguration(CONFIG_KEYS.badges)) {
          this.updateDecorations();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.repos.markStale();
        void this.reload();
      }),
      // Çoklu repo: liste/seçim webview'lara (kök değişince model'den önce gider), seçim değişince yeniden tara.
      repos.onDidChange((s) => this.broadcast({ type: 'repos', repos: s.repos, current: s.current, follow: s.follow })),
      repos.onDidSelect(() => void this.reload()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.attach(view.webview, view.onDidDispose, () => view.visible, view.onDidChangeVisibility);
  }

  /** Haritayı düzenleyici alanında bir sekmede açar; zaten açıksa öne getirir. */
  openInEditor(): void {
    if (this.editorPanel) {
      this.editorPanel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      GitAtlasRevRevPanelProvider.editorViewType,
      panelText().editorTitle,
      vscode.ViewColumn.Active,
      { retainContextWhenHidden: true },
    );
    this.adoptEditorPanel(panel);
  }

  /** Pencere yeniden yüklendiğinde açık kalan sekmeyi geri getirir. */
  async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
    this.adoptEditorPanel(panel);
  }

  private adoptEditorPanel(panel: vscode.WebviewPanel): void {
    this.editorPanel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
    panel.onDidDispose(() => {
      if (this.editorPanel === panel) this.editorPanel = undefined;
    });
    this.attach(panel.webview, panel.onDidDispose, () => panel.visible, panel.onDidChangeViewState);
  }

  private attach(
    webview: vscode.Webview,
    onDidDispose: vscode.Event<void>,
    isVisible: () => boolean,
    onDidChangeVisibility: vscode.Event<unknown>,
  ): void {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    webview.html = this.renderHtml(webview);
    this.webviews.get(webview)?.disposables.forEach((d) => d.dispose());
    this.webviews.set(webview, {
      isVisible,
      disposables: [
        webview.onDidReceiveMessage((raw: unknown) => void this.onMessage(raw, webview)),
        onDidChangeVisibility(() => this.updateVisibility()),
        onDidDispose(() => {
          this.webviews.get(webview)?.disposables.forEach((d) => d.dispose());
          this.webviews.delete(webview);
          this.updateVisibility();
        }),
      ],
    });
    this.updateVisibility();
  }

  /** GitHub katmanı yalnızca en az bir webview görünürken yenilenir. */
  private updateVisibility(): void {
    const visible = [...this.webviews.values()].some((w) => w.isVisible());
    if (visible === this.anyVisible) return;
    this.anyVisible = visible;
    this.github.setVisible(visible);
  }

  /** Tarar ve her şeyi günceller. Devam eden tarama varsa bitince bir kez daha çalışır (paralel tarama yok). */
  reload(): Promise<void> {
    this.started = true;
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.doReload();
        } while (this.rerun && !this.disposed);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** Repo listesini de yeniden bulup tarar (Yenile düğmesi/komutu: başka bir klasörde sonradan git init yapılmış olabilir). */
  refreshAll(): Promise<void> {
    this.repos.markStale();
    return this.reload();
  }

  /** Sürmekte olan ya da sırada bekleyen yazma işlemi var mı? */
  get busy(): boolean {
    return this.opQueue.busy;
  }

  dispose(): void {
    this.disposed = true;
    this.webviews.forEach((w) => w.disposables.forEach((d) => d.dispose()));
    this.webviews.clear();
    this.editorPanel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  // ---- tarama ----

  private async doReload(): Promise<void> {
    const startedAt = Date.now();
    try {
      const prevRoot = this.root;
      const root = await this.resolveRoot();
      // Kök aynıysa (setRoot zaten çağrılmadıysa) origin sonradan eklenmiş olabilir.
      if (root === prevRoot) void this.redetectRemote();
      this.post({ type: 'loading', progress: 0 });
      this.statusBar.setScanning(0);
      const snapshot = await loadSnapshot(root, this.storageDir, (p) => {
        if (this.disposed) return;
        this.post({ type: 'loading', progress: p });
        this.statusBar.setScanning(p);
      });
      if (this.disposed) return;
      this.snapshot = snapshot;
      const fileCount = this.publishModel();
      // Snapshot bu taramadan önce üretildiyse cache'ten gelmiştir.
      if (fileCount !== undefined) this.statusBar.setReady(fileCount, snapshot.generatedAt < startedAt);
      await this.refreshRefs();
      if (this.disposed) return;
      this.publishDerived();
      if (this.graphParams) void this.requestGraph(this.graphParams);
      if (this.statusRequested) void this.refreshStatus();
    } catch (err) {
      if (this.disposed) return;
      this.snapshot = undefined;
      this.files = [];
      this.refs = undefined;
      this.refsEmitter.fire(undefined);
      this.decorations.update([], this.root ?? '');
      const e = err instanceof NoWorkspaceError
        ? { code: 'noWorkspace' as const, message: panelText().errNoWorkspace, short: panelText().errNoWorkspaceShort }
        : mapError(err);
      this.post({ type: 'error', code: e.code, message: e.message });
      this.statusBar.setError(e.short);
    }
  }

  private async resolveRoot(): Promise<string> {
    await this.repos.ensure();
    const selected = this.repos.currentRoot;
    if (selected) {
      this.setRoot(selected);
      return selected;
    }
    // Hiç repo bulunamadı: hatayı (klasör yok / repo değil / git yok) ilk klasör üzerinden üret.
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== 'file') {
      this.setRoot(undefined);
      throw new NoWorkspaceError();
    }
    let out: string;
    try {
      out = (await runGit(['rev-parse', '--show-toplevel'], folder.uri.fsPath)).trim();
    } catch (err) {
      this.setRoot(undefined);
      throw err;
    }
    const root = vscode.Uri.file(out).fsPath;
    this.setRoot(root);
    return root;
  }

  private setRoot(root: string | undefined): void {
    if (root === this.root) return;
    this.root = root;
    this.snapshot = undefined;
    this.graph = undefined;
    this.lastGraphState = undefined;
    this.lastTimeline = undefined;
    this.lastContrib = undefined;
    this.lastStatus = undefined;
    this.lastStashes = undefined;
    this.ops = undefined;
    this.githubOps = undefined;
    this.lastPrPanel = undefined;
    this.lastPrPanelMsg = undefined;
    // Branch adları repoya özgü: graph tüm branch'lerle yeniden yüklenir, Branch'ler seçimi kalkar.
    if (this.graphParams) this.graphParams = { limit: this.graphParams.limit };
    this.selectedBranch = undefined;
    this.watcher?.dispose();
    this.watcher = undefined;
    this.ensureWatcher();
    this.watchGitConfig(root);
    void this.github.setRoot(root);
    if (root !== undefined) this.rootEmitter.fire(root);
  }

  private watchGitConfig(root: string | undefined): void {
    this.gitConfigWatcher?.dispose();
    this.gitConfigWatcher = undefined;
    if (!root) return;
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '.git/config'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void this.redetectRemote();
      }, 500);
    };
    this.gitConfigWatcher = vscode.Disposable.from(w, w.onDidChange(onChange), w.onDidCreate(onChange), {
      dispose: () => {
        if (timer) clearTimeout(timer);
      },
    });
  }

  /** GitHub katmanı bağlı değilken remote'u yeniden algılatır (origin sonradan eklendiyse katman devreye girer). */
  private async redetectRemote(): Promise<void> {
    const root = this.root;
    if (!root || this.disposed || !needsRemoteRedetect(this.github.data.status)) return;
    await this.github.setRoot(root);
  }

  /**
   * "GitHub ile bağlan": ayar kapalıysa ayarı, origin yoksa "GitHub'da yayınla"yı, origin GitHub değilse
   * nedenini gösterir; aksi hâlde bağlanır. Webview düğmesi ve gitatlas-revrev.github.connect komutu bunu kullanır.
   */
  async connectGitHub(): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('gitatlas-revrev').get<unknown>('github.enabled') !== false;
    const status = this.github.data.status;
    const t = panelText();
    switch (githubConnectAction(status, enabled)) {
      case 'disabled': {
        const choice = await vscode.window.showInformationMessage(t.githubDisabled, t.openSetting);
        if (choice) await vscode.commands.executeCommand('workbench.action.openSettings', 'gitatlas-revrev.github.enabled');
        return;
      }
      case 'publish-prompt': {
        const choice = await vscode.window.showInformationMessage(t.notOnGitHub, t.publishToGitHub);
        if (choice) await this.publishToGitHub();
        return;
      }
      case 'not-github': {
        const url = status.state === 'notGitHub' ? status.remoteUrl : '';
        void vscode.window.showInformationMessage(t.notGitHub(redactSecrets(url)));
        return;
      }
      case 'connect':
        try {
          await this.github.connect(); // iptal edilirse durum 'off' kalır; bir şey göstermeyiz
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(t.connectFailed(text));
        }
        return;
    }
  }

  /** VS Code'un yerleşik "GitHub'da yayınla" akışı (repo oluştur + origin + push); sonra remote'u yeniden algılar. */
  async publishToGitHub(): Promise<void> {
    const commands = await vscode.commands.getCommands(true);
    const cmd = commands.includes('github.publish') ? 'github.publish' : commands.includes('git.publish') ? 'git.publish' : undefined;
    if (!cmd) {
      void vscode.window.showErrorMessage(panelText().publishCommandMissing);
      return;
    }
    try {
      await vscode.commands.executeCommand(cmd);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(panelText().publishFailed(text));
    }
    await this.redetectRemote();
    void this.reload();
  }

  /** Bellekteki snapshot'tan dosyaları hesaplar, rozetleri ve webview'ı günceller. Dosya sayısını döner. */
  private publishModel(): number | undefined {
    const snapshot = this.snapshot;
    const root = this.root;
    if (!snapshot || !root) return undefined;
    try {
      const files = computeFileStats(snapshot, this.range, getIgnoreGlobs(), Date.now());
      this.files = files;
      this.updateDecorations();
      this.post({
        type: 'model',
        range: this.range,
        repoName: path.basename(root),
        files,
        commits: snapshot.commits.slice(0, MAX_COMMITS),
        graphPageSize: getGraphPageSize(),
      });
      return files.length;
    } catch (err) {
      const e = mapError(err);
      this.post({ type: 'error', code: e.code, message: e.message });
      this.statusBar.setError(e.short);
      return undefined;
    }
  }

  /** Git'e gitmeden yeniden hesaplar (aralık/ignore değişimi). Tarama sürüyorsa sonucu zaten güncel ayarı kullanır. */
  private recompute(): void {
    if (this.running) return;
    this.publishModel();
    this.publishDerived();
  }

  /** Explorer rozetleri: son dosyalar + (GitHub bağlı ya da eski veride) dosya başına açık PR sayısı. */
  private updateDecorations(): void {
    const root = this.root;
    if (!root || !this.snapshot) return;
    const s = this.github.data.status.state;
    const prCounts = s === 'connected' || s === 'stale' ? countPrsByFile(this.github.data.pullRequests) : undefined;
    this.decorations.update(this.files, root, prCounts);
  }

  private onGitHubChange(data: GitHubData): void {
    this.broadcast({ type: 'github', data });
    this.statusBar.setGitHub(data);
    this.updateDecorations();
    if (this.prPanelRequested && data.status.state === 'connected') void this.refreshPrPanel();
  }

  // ---- v5: çalışma ağacı ve git işlemleri ----

  private ensureWatcher(): void {
    if (!this.statusRequested || !this.root || this.watcher || this.disposed) return;
    this.watcher = new WorkingTreeWatcher(this.root, () => void this.refreshStatus());
  }

  /** getStatus + listStashes → webview'lar. Aynı anda gelen istekler birleşir. */
  private refreshStatus(): Promise<void> {
    if (this.statusRunning) {
      this.statusRerun = true;
      return this.statusRunning;
    }
    this.statusRunning = (async () => {
      try {
        do {
          this.statusRerun = false;
          await this.doRefreshStatus();
        } while (this.statusRerun && !this.disposed);
      } finally {
        this.statusRunning = undefined;
      }
    })();
    return this.statusRunning;
  }

  private async doRefreshStatus(): Promise<void> {
    let root: string;
    try {
      root = this.root ?? (await this.resolveRoot());
    } catch {
      return; // repo yok: panel zaten hata durumunu gösteriyor
    }
    this.ensureWatcher();
    try {
      const [status, stashes] = await Promise.all([getStatus(root), listStashes(root)]);
      if (this.disposed || root !== this.root) return;
      const branchChanged = this.lastStatus !== undefined && this.lastStatus.branch !== status.branch;
      this.lastStatus = status;
      if (branchChanged && this.prPanelRequested) void this.refreshPrPanel();
      this.lastStashes = stashes;
      this.broadcast({ type: 'status', status });
      this.broadcast({ type: 'stashes', stashes });
    } catch (err) {
      this.log(panelText().logStatusFailed(err instanceof Error ? err.message : String(err)));
    }
  }

  private log(line: string): void {
    this.output.appendLine(redactSecrets(line, [...this.secrets]));
  }

  /** "GitAtlas-Rev Git" çıktı kanalını gösterir. */
  showGitOutput(): void {
    this.output.show(true);
  }

  /** Mevcut çalışma ağacı durumu (son okunan); komutlar için. */
  get workingTreeStatus(): WorkingTreeStatus | undefined {
    return this.lastStatus;
  }

  private async getToken(): Promise<string | undefined> {
    const state = this.github.data.status.state;
    if (state !== 'connected' && state !== 'stale') return undefined;
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false, silent: true });
      if (session?.accessToken) this.secrets.add(session.accessToken);
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }

  private opsFor(root: string): GitOpsService {
    if (this.ops?.root !== root) {
      const service = new GitOpsService(
        {
          root,
          ui: createVscodeOpsUi(),
          getToken: () => this.getToken(),
          pullStrategy: () => getPullStrategy(),
          log: (line) => this.log(line),
        },
        this.opQueue,
      );
      this.ops = { root, service };
    }
    return this.ops.service;
  }

  private githubOpsFor(root: string): GitHubOpsService {
    if (this.githubOps?.root !== root) {
      const service = new GitHubOpsService({
        root,
        ui: createVscodeOpsUi(),
        gitOps: this.opsFor(root),
        queue: this.opQueue,
        coords: () => this.github.repoCoords,
        getToken: () => this.getToken(),
        fetchFn: fetch,
        log: (line) => this.log(line),
        getPr: (n) => findPrDetail(n, this.lastPrPanel, this.github.data.pullRequests),
        defaultBranch: () => this.lastPrPanel?.defaultBranch,
      });
      this.githubOps = { root, service };
    }
    return this.githubOps.service;
  }

  private newCommandId(): string {
    return `cmd-${Date.now().toString(36)}-${++this.opCounter}`;
  }

  /** Komutlardan gelen işlem başarısız olursa "Çıktıyı göster" düğmeli hata bildirimi. */
  private notifyFailure(result: OpResult): void {
    if (result.ok || result.cancelled) return;
    void vscode.window.showErrorMessage(`GitAtlas-Rev: ${result.message}`, panelText().showOutput).then((choice) => {
      if (choice) this.showGitOutput();
    });
  }

  /**
   * Komutlardan (palet, Branch'ler menüsü) git işlemi. Sonuç webview'lara da opResult olarak gider;
   * hata olursa ayrıca "Çıktıyı göster" düğmeli bir hata bildirimi çıkar.
   */
  async runOp(op: GitOpRequest): Promise<OpResult> {
    const result = await this.executeOp(this.newCommandId(), op);
    this.notifyFailure(result);
    return result;
  }

  /** Komutlardan GitHub işlemi (PR aç/birleştir/checkout); runOp ile aynı bildirim davranışı. */
  async runGitHubOp(op: GitHubOpRequest): Promise<OpResult> {
    const result = await this.executeGitHubOp(this.newCommandId(), op);
    this.notifyFailure(result);
    return result;
  }

  /** Kökü bulur, işlemi çalıştırır (opStarted → opResult tüm webview'lara); hata fırlatırsa ok:false sonuç. */
  private async execute(
    id: string,
    kind: GitOpKind | GitHubOpKind,
    run: (root: string, onStarted: (commands: string[]) => void) => Promise<OpResult>,
  ): Promise<OpResult> {
    let result: OpResult;
    let root: string | undefined;
    try {
      root = this.root ?? (await this.resolveRoot());
    } catch {
      root = undefined;
    }
    if (!root) {
      result = { id, kind, ok: false, commands: [], message: panelText().noRepoOpen };
    } else {
      try {
        result = await run(root, (commands) => this.broadcast({ type: 'opStarted', id, kind, commands }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(panelText().logOpError(kind, message));
        result = { id, kind, ok: false, commands: [], message: panelText().opFailed(message) };
      }
    }
    if (!this.disposed) this.broadcast({ type: 'opResult', result });
    return result;
  }

  private async executeOp(id: string, op: GitOpRequest): Promise<OpResult> {
    const result = await this.execute(id, op.kind, (root, onStarted) => this.opsFor(root).run(id, op, onStarted));
    if (this.disposed) return result;
    if (result.ok && opChangesRefs(op.kind)) void this.reload();
    if (this.statusRequested) void this.refreshStatus();
    return result;
  }

  private async executeGitHubOp(id: string, op: GitHubOpRequest): Promise<OpResult> {
    const result = await this.execute(id, op.kind, (root, onStarted) => this.githubOpsFor(root).run(id, op, onStarted));
    if (this.disposed) return result;
    if (result.ok) {
      void this.reload(); // reload sonunda status da yenilenir
      void this.github.refresh();
    } else if (this.statusRequested) {
      void this.refreshStatus();
    }
    if (this.prPanelRequested) void this.refreshPrPanel();
    return result;
  }

  // ---- v5 2. tur: PR paneli ve taslak ----

  /** PR paneli verisini çeker ve gönderir. Aynı anda tek istek; arada gelenler birleşir. */
  private refreshPrPanel(): Promise<void> {
    if (this.prPanelRunning) {
      this.prPanelRerun = true;
      return this.prPanelRunning;
    }
    this.prPanelRunning = (async () => {
      try {
        do {
          this.prPanelRerun = false;
          await this.doRefreshPrPanel();
        } while (this.prPanelRerun && !this.disposed);
      } finally {
        this.prPanelRunning = undefined;
      }
    })();
    return this.prPanelRunning;
  }

  private postPrPanel(msg: ExtensionToWebview): void {
    this.lastPrPanelMsg = msg;
    this.broadcast(msg);
  }

  private async doRefreshPrPanel(): Promise<void> {
    const state = this.github.data.status.state;
    const coords = this.github.repoCoords;
    if ((state !== 'connected' && state !== 'stale') || !coords) {
      this.lastPrPanel = undefined;
      this.postPrPanel({ type: 'prPanel', data: undefined });
      return;
    }
    const root = this.root;
    try {
      const token = await this.getToken();
      if (!token) throw new Error(panelText().noGitHubSession);
      const branch = this.lastStatus?.branch ?? this.refs?.find((r) => r.kind === 'local' && r.isHead)?.name;
      const data = await fetchPrPanel(token, coords.owner, coords.repo, branch, fetch);
      if (this.disposed || this.prPanelRerun || root !== this.root) return; // daha yeni istek ya da kök değişti
      this.lastPrPanel = data;
      this.postPrPanel({ type: 'prPanel', data });
    } catch (err) {
      if (this.disposed || this.prPanelRerun || root !== this.root) return;
      const text = err instanceof Error ? err.message : String(err);
      this.log(panelText().logPrPanelFailed(text));
      this.postPrPanel({ type: 'prPanel', data: this.lastPrPanel, error: panelText().prPanelFailed(redactSecrets(text, [...this.secrets])) });
    }
  }

  private async loadPrDraft(base: string | undefined): Promise<void> {
    try {
      const root = this.root ?? (await this.resolveRoot());
      const draft = await computePrDraft(root, base, this.lastPrPanel?.defaultBranch);
      this.broadcast({ type: 'prDraft', draft });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      this.log(panelText().logPrDraftFailed(text));
      this.broadcast({ type: 'prDraft', draft: undefined, error: panelText().prDraftFailed(text) });
    }
  }

  private async openChange(relPath: string, staged: boolean): Promise<void> {
    const root = this.root;
    if (!root) return;
    const file = this.lastStatus?.files.find((f) => f.path === relPath);
    const name = relPath.slice(relPath.lastIndexOf('/') + 1);
    if (file?.conflicted) {
      await this.openFile(relPath); // çakışma işaretleriyle dosyanın kendisi
      return;
    }
    if (staged) {
      const left = file?.staged === 'added' ? makeGitUri(root, '', relPath) : makeGitUri(root, 'HEAD', file?.oldPath ?? relPath);
      const right = makeGitUri(root, file?.staged === 'deleted' ? '' : INDEX_REF, relPath);
      await vscode.commands.executeCommand('vscode.diff', left, right, panelText().diffHeadIndex(name));
      return;
    }
    const left = makeGitUri(root, file?.unstaged === 'untracked' ? '' : INDEX_REF, relPath);
    const right =
      file?.unstaged === 'deleted'
        ? makeGitUri(root, '', relPath)
        : vscode.Uri.joinPath(vscode.Uri.file(root), ...relPath.split('/'));
    await vscode.commands.executeCommand('vscode.diff', left, right, panelText().diffIndexWorking(name));
  }

  // ---- v4: zaman makinesi ve katkı ----

  /** İstenmiş olan timeline/contrib verisini snapshot'tan yeniden üretip gönderir. */
  private publishDerived(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const ignore = getIgnoreGlobs();
    const now = Date.now();
    if (this.timelineRequested) {
      try {
        const timeline = buildTimeline(snapshot, computeFileStats(snapshot, 'all', ignore, now), this.refs);
        this.lastTimeline = { type: 'timeline', timeline };
        this.broadcast(this.lastTimeline);
      } catch (err) {
        this.reportDerivedError(panelText().timeMachine, err);
      }
    }
    if (this.contribRange) {
      const range = this.contribRange;
      try {
        const contrib = computeContrib(snapshot.commits, computeFileStats(snapshot, range, ignore, now), range, now);
        this.lastContrib = { type: 'contrib', contrib };
        this.broadcast(this.lastContrib);
      } catch (err) {
        this.reportDerivedError(panelText().contribPanel, err);
      }
    }
  }

  private reportDerivedError(what: string, err: unknown): void {
    const text = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(panelText().derivedFailed(what, text));
  }

  // ---- branch'ler ve graph ----

  /** Ref listesini yeniden okur ve onDidLoadRefs'i ateşler (hata/repo yoksa undefined). */
  async refreshRefs(): Promise<void> {
    try {
      const root = this.root ?? (await this.resolveRoot());
      const refs = await listRefs(root);
      const headOf = (rs: GitRef[] | undefined): string | undefined => rs?.find((r) => r.kind === 'local' && r.isHead)?.name;
      // Durum izlenmiyorsa branch değişimini (checkout) PR paneli için buradan yakala.
      const branchChanged = this.refs !== undefined && headOf(this.refs) !== headOf(refs);
      this.refs = refs;
      if (!this.disposed) this.refsEmitter.fire(refs);
      if (branchChanged && this.prPanelRequested && !this.statusRequested) void this.refreshPrPanel();
    } catch {
      this.refs = undefined;
      if (!this.disposed) this.refsEmitter.fire(undefined);
    }
  }

  /** Branch'ler panelindeki seçimi tüm webview'lara iletir. */
  selectBranch(name: string | undefined): void {
    this.selectedBranch = name;
    this.broadcast({ type: 'selectBranch', name });
  }

  /** Graph'ı yükler. Devam eden yükleme varsa bitince son parametrelerle bir kez daha çalışır; eski sonuç atılır. */
  private requestGraph(params: { limit: number; branch?: string }): Promise<void> {
    this.graphParams = params;
    if (this.graphRunning) {
      this.graphRerun = true;
      return this.graphRunning;
    }
    this.graphRunning = (async () => {
      try {
        do {
          this.graphRerun = false;
          await this.doLoadGraph();
        } while (this.graphRerun && !this.disposed);
      } finally {
        this.graphRunning = undefined;
      }
    })();
    return this.graphRunning;
  }

  private async doLoadGraph(): Promise<void> {
    const params = this.graphParams;
    if (!params) return;
    this.postGraph({ type: 'graphLoading' });
    try {
      const root = this.root ?? (await this.resolveRoot());
      const graph = await loadGraph(root, { limit: params.limit, branch: params.branch });
      if (this.disposed || this.graphRerun) return; // daha yeni bir istek var; o sonucu gönderecek
      this.graph = graph;
      this.postGraph({ type: 'graph', graph });
    } catch (err) {
      if (this.disposed || this.graphRerun) return;
      const message = err instanceof NoWorkspaceError ? panelText().errNoWorkspace : mapError(err).message;
      this.postGraph({ type: 'graphError', message });
    }
  }

  // ---- mesajlar ----

  private broadcast(msg: ExtensionToWebview): void {
    for (const webview of this.webviews.keys()) void webview.postMessage(msg);
  }

  /** Harita durumu (model/loading/error): saklanır ve tüm webview'lara gönderilir. */
  private post(msg: ExtensionToWebview): void {
    this.lastState = msg;
    this.broadcast(msg);
  }

  /** Graph durumu (graphLoading/graph/graphError): saklanır ve tüm webview'lara gönderilir. */
  private postGraph(msg: ExtensionToWebview): void {
    this.lastGraphState = msg;
    this.broadcast(msg);
  }

  private async onMessage(raw: unknown, from: vscode.Webview): Promise<void> {
    const msg = parseWebviewMessage(raw);
    if (!msg) return;
    try {
      switch (msg.type) {
        case 'ready': {
          const rs = this.repos.snapshot;
          void from.postMessage({ type: 'repos', repos: rs.repos, current: rs.current, follow: rs.follow });
          if (this.lastState) void from.postMessage(this.lastState);
          if (this.lastGraphState) void from.postMessage(this.lastGraphState);
          if (this.selectedBranch !== undefined) void from.postMessage({ type: 'selectBranch', name: this.selectedBranch });
          void from.postMessage({ type: 'github', data: this.github.data });
          if (this.lastTimeline) void from.postMessage(this.lastTimeline);
          if (this.lastContrib) void from.postMessage(this.lastContrib);
          if (this.lastStatus) void from.postMessage({ type: 'status', status: this.lastStatus });
          if (this.lastStashes) void from.postMessage({ type: 'stashes', stashes: this.lastStashes });
          if (this.lastPrPanelMsg) void from.postMessage(this.lastPrPanelMsg);
          if (!this.started) void this.reload();
          break;
        }
        case 'setRange':
          this.range = msg.range;
          this.recompute();
          break;
        case 'refresh':
          await this.refreshAll();
          break;
        case 'openFile':
          await this.openFile(msg.path);
          break;
        case 'openDiff':
          await this.openDiff(msg.path, msg.hash);
          break;
        case 'command':
          await this.runAction(msg.action);
          break;
        case 'loadGraph':
          await this.requestGraph({ limit: msg.limit, branch: msg.branch });
          break;
        case 'githubConnect':
          await this.connectGitHub();
          break;
        case 'githubPublish':
          await this.publishToGitHub();
          break;
        case 'branchMenu':
          this.branchActionEmitter.fire('menu');
          break;
        case 'branchCreate':
          this.branchActionEmitter.fire('create');
          break;
        case 'repoMenu':
          await this.repos.showPicker();
          break;
        case 'githubDismiss':
          this.github.dismiss();
          break;
        case 'githubRefresh':
          await this.github.refresh();
          break;
        case 'openUrl':
          await vscode.env.openExternal(vscode.Uri.parse(msg.url, true));
          break;
        case 'loadTimeline':
          this.timelineRequested = true;
          if (!this.running) this.publishDerived();
          break;
        case 'loadContrib':
          this.contribRange = msg.range;
          if (!this.running) this.publishDerived();
          break;
        case 'loadStatus':
          this.statusRequested = true;
          this.ensureWatcher();
          await this.refreshStatus();
          break;
        case 'gitOp':
          await this.executeOp(msg.id, msg.op);
          break;
        case 'openChange':
          await this.openChange(msg.path, msg.staged);
          break;
        case 'showOutput':
          this.showGitOutput();
          break;
        case 'loadPrPanel':
          this.prPanelRequested = true;
          await this.refreshPrPanel();
          break;
        case 'loadPrDraft':
          await this.loadPrDraft(msg.base);
          break;
        case 'githubOp':
          await this.executeGitHubOp(msg.id, msg.op);
          break;
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`GitAtlas-Rev: ${text}`);
    }
  }

  private async openFile(relPath: string): Promise<void> {
    if (!this.root) return;
    const uri = vscode.Uri.joinPath(vscode.Uri.file(this.root), ...relPath.split('/'));
    try {
      await vscode.window.showTextDocument(uri, { preview: true });
    } catch {
      // Metin olarak açılamayan (binary) dosyalar için VS Code'un kendi açıcısı.
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  private async openDiff(relPath: string, hash: string): Promise<void> {
    const root = this.root;
    // Önce harita snapshot'ı; bulunamazsa graph (diğer branch'lerdeki commit'leri de içerir).
    const match = (c: { hash: string }): boolean => c.hash === hash || c.hash.startsWith(hash);
    const commit = this.snapshot?.commits.find(match) ?? this.graph?.commits.find(match);
    if (!root || !commit) {
      void vscode.window.showWarningMessage(panelText().commitNotFound);
      return;
    }
    const change = commit.files.find((f) => f.path === relPath || f.oldPath === relPath);
    const newPath = change?.path ?? relPath;
    const oldPath = change?.oldPath ?? newPath;
    const left = makeGitUri(root, commit.parents[0] ?? '', oldPath);
    const right = makeGitUri(root, commit.hash, newPath);
    const baseName = newPath.slice(newPath.lastIndexOf('/') + 1);
    const title = `${baseName} (${commit.shortHash}^ ↔ ${commit.shortHash})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  private async runAction(action: StateAction): Promise<void> {
    switch (action) {
      case 'initRepo':
        await vscode.commands.executeCommand('git.init');
        break;
      case 'openFolder':
        await vscode.commands.executeCommand('vscode.openFolder');
        break;
      case 'openScm':
        await vscode.commands.executeCommand('workbench.view.scm');
        break;
      case 'openGitPathSetting':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'git.path');
        break;
      case 'downloadGit':
        await vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
        break;
    }
  }

  // ---- HTML ----

  private renderHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const asset = (...p: string[]): string => webview.asWebviewUri(vscode.Uri.joinPath(dist, ...p)).toString();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const lang = getLang();
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${asset('webview.css')}">
<title>GitAtlas-Rev</title>
</head>
<body data-lang="${lang}">
<div id="app"></div>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
  }
}
