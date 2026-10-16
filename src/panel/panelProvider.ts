import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_KEYS, getDefaultRange, getGitPath, getGraphPageSize, getIgnoreGlobs } from '../config';
import { countPrsByFile, type HeatDecorationProvider } from '../decorations/heatDecorations';
import { GitError, runGit, setGitPath } from '../git/gitRunner';
import { listRefs } from '../git/refs';
import type { GitHubLayer } from '../github/githubLayer';
import { computeFileStats } from '../model/aggregate';
import { computeContrib } from '../model/contrib';
import { loadGraph } from '../model/graphService';
import { loadSnapshot, NoCommitsError } from '../model/repoService';
import { buildTimeline } from '../model/timeline';
import type { ErrorCode, ExtensionToWebview, StateAction, WebviewToExtension } from '../protocol';
import type { FileStat, GitHubData, GitRef, GraphData, RepoSnapshot, TimeRange } from '../types';
import { makeGitUri } from './gitContentProvider';
import type { RewiewRevStatusBar } from './statusBar';

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
    default:
      return undefined;
  }
}

/** Hata → panel durum kodu + kısa durum çubuğu metni. */
export function mapError(err: unknown): { code: ErrorCode; message: string; short: string } {
  if (err instanceof GitError) {
    if (err.code === 'notFound') return { code: 'noGit', message: err.message, short: 'Git bulunamadı' };
    if (err.code === 'notRepo') return { code: 'noRepo', message: err.message, short: 'git reposu yok' };
  }
  if (err instanceof NoCommitsError) {
    return { code: 'noCommits', message: err.message || 'Bu repoda henüz commit yok.', short: 'henüz commit yok' };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'unknown', message, short: 'tarama başarısız' };
}

class NoWorkspaceError extends Error {}

export class RewiewRevPanelProvider implements vscode.WebviewViewProvider, vscode.WebviewPanelSerializer, vscode.Disposable {
  static readonly viewType = 'rewiewrev.panel';
  /** Düzenleyici alanındaki sekme ("RewiewRev: Harita"). */
  static readonly editorViewType = 'rewiewrev.editor';

  private readonly rootEmitter = new vscode.EventEmitter<string>();
  readonly onDidResolveRoot: vscode.Event<string> = this.rootEmitter.event;

  private readonly refsEmitter = new vscode.EventEmitter<GitRef[] | undefined>();
  /** Her reload'da (ve refreshRefs'te) listRefs sonucu; hata/repo yoksa undefined. */
  readonly onDidLoadRefs: vscode.Event<GitRef[] | undefined> = this.refsEmitter.event;

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

  private running: Promise<void> | undefined;
  private rerun = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storageDir: string,
    private readonly decorations: HeatDecorationProvider,
    private readonly statusBar: RewiewRevStatusBar,
    private readonly github: GitHubLayer,
  ) {
    setGitPath(getGitPath());
    this.statusBar.setGitHub(github.data);
    this.disposables.push(
      this.rootEmitter,
      this.refsEmitter,
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
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
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
      RewiewRevPanelProvider.editorViewType,
      'RewiewRev: Harita',
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
      const root = await this.resolveRoot();
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
    } catch (err) {
      if (this.disposed) return;
      this.snapshot = undefined;
      this.files = [];
      this.refs = undefined;
      this.refsEmitter.fire(undefined);
      this.decorations.update([], this.root ?? '');
      const e = err instanceof NoWorkspaceError
        ? { code: 'noWorkspace' as const, message: 'Açık bir klasör yok.', short: 'klasör açık değil' }
        : mapError(err);
      this.post({ type: 'error', code: e.code, message: e.message });
      this.statusBar.setError(e.short);
    }
  }

  private async resolveRoot(): Promise<string> {
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
    void this.github.setRoot(root);
    if (root !== undefined) this.rootEmitter.fire(root);
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
        this.reportDerivedError('Zaman makinesi', err);
      }
    }
    if (this.contribRange) {
      const range = this.contribRange;
      try {
        const contrib = computeContrib(snapshot.commits, computeFileStats(snapshot, range, ignore, now), range, now);
        this.lastContrib = { type: 'contrib', contrib };
        this.broadcast(this.lastContrib);
      } catch (err) {
        this.reportDerivedError('Katkı paneli', err);
      }
    }
  }

  private reportDerivedError(what: string, err: unknown): void {
    const text = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`RewiewRev: ${what} hazırlanamadı: ${text}`);
  }

  // ---- branch'ler ve graph ----

  /** Ref listesini yeniden okur ve onDidLoadRefs'i ateşler (hata/repo yoksa undefined). */
  async refreshRefs(): Promise<void> {
    try {
      const root = this.root ?? (await this.resolveRoot());
      const refs = await listRefs(root);
      this.refs = refs;
      if (!this.disposed) this.refsEmitter.fire(refs);
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
      const message = err instanceof NoWorkspaceError ? 'Açık bir klasör yok.' : mapError(err).message;
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
        case 'ready':
          if (this.lastState) void from.postMessage(this.lastState);
          if (this.lastGraphState) void from.postMessage(this.lastGraphState);
          if (this.selectedBranch !== undefined) void from.postMessage({ type: 'selectBranch', name: this.selectedBranch });
          void from.postMessage({ type: 'github', data: this.github.data });
          if (this.lastTimeline) void from.postMessage(this.lastTimeline);
          if (this.lastContrib) void from.postMessage(this.lastContrib);
          if (!this.started) void this.reload();
          break;
        case 'setRange':
          this.range = msg.range;
          this.recompute();
          break;
        case 'refresh':
          await this.reload();
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
          await this.github.connect();
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
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`RewiewRev: ${text}`);
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
      void vscode.window.showWarningMessage('RewiewRev: commit bulunamadı. Haritayı yenileyip tekrar deneyin.');
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
    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${asset('webview.css')}">
<title>RewiewRev</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
  }
}
