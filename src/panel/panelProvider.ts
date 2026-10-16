import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getIgnoreGlobs } from '../config';
import type { HeatDecorationProvider } from '../decorations/heatDecorations';
import { GitError, runGit } from '../git/gitRunner';
import { computeFileStats } from '../model/aggregate';
import { loadSnapshot, NoCommitsError } from '../model/repoService';
import type { ErrorCode, ExtensionToWebview, StateAction, WebviewToExtension } from '../protocol';
import type { RepoSnapshot, TimeRange } from '../types';
import { makeGitUri } from './gitContentProvider';
import type { RewiewRevStatusBar } from './statusBar';

const RANGES: readonly TimeRange[] = ['7d', '30d', 'all'];
const ACTIONS: readonly StateAction[] = ['openFolder', 'initRepo', 'openScm', 'openGitPathSetting', 'downloadGit'];
const MAX_COMMITS = 1000;

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

  /** Açık webview'lar (yan panel ve/veya düzenleyici sekmesi); hepsi aynı modeli alır. */
  private readonly webviews = new Map<vscode.Webview, vscode.Disposable[]>();
  private editorPanel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private root: string | undefined;
  private snapshot: RepoSnapshot | undefined;
  private range: TimeRange = '30d';
  /** Webview'a gönderilen son durum (model/loading/error); `ready` gelince yeniden gönderilir. */
  private lastState: ExtensionToWebview | undefined;

  private running: Promise<void> | undefined;
  private rerun = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storageDir: string,
    private readonly decorations: HeatDecorationProvider,
    private readonly statusBar: RewiewRevStatusBar,
  ) {
    this.disposables.push(
      this.rootEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('rewiewrev.ignore')) this.recompute();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.attach(view.webview, view.onDidDispose);
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
    this.attach(panel.webview, panel.onDidDispose);
  }

  private attach(webview: vscode.Webview, onDidDispose: vscode.Event<void>): void {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    webview.html = this.renderHtml(webview);
    this.webviews.get(webview)?.forEach((d) => d.dispose());
    this.webviews.set(webview, [
      webview.onDidReceiveMessage((raw: unknown) => void this.onMessage(raw, webview)),
      onDidDispose(() => {
        this.webviews.get(webview)?.forEach((d) => d.dispose());
        this.webviews.delete(webview);
      }),
    ]);
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
    this.webviews.forEach((ds) => ds.forEach((d) => d.dispose()));
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
    } catch (err) {
      if (this.disposed) return;
      this.snapshot = undefined;
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
      this.root = undefined;
      throw new NoWorkspaceError();
    }
    const out = (await runGit(['rev-parse', '--show-toplevel'], folder.uri.fsPath)).trim();
    const root = vscode.Uri.file(out).fsPath;
    if (root !== this.root) {
      this.root = root;
      this.snapshot = undefined;
      this.rootEmitter.fire(root);
    }
    return root;
  }

  /** Bellekteki snapshot'tan dosyaları hesaplar, rozetleri ve webview'ı günceller. Dosya sayısını döner. */
  private publishModel(): number | undefined {
    const snapshot = this.snapshot;
    const root = this.root;
    if (!snapshot || !root) return undefined;
    try {
      const files = computeFileStats(snapshot, this.range, getIgnoreGlobs(), Date.now());
      this.decorations.update(files, root);
      this.post({
        type: 'model',
        range: this.range,
        repoName: path.basename(root),
        files,
        commits: snapshot.commits.slice(0, MAX_COMMITS),
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
  }

  // ---- mesajlar ----

  private post(msg: ExtensionToWebview): void {
    this.lastState = msg;
    for (const webview of this.webviews.keys()) void webview.postMessage(msg);
  }

  private async onMessage(raw: unknown, from: vscode.Webview): Promise<void> {
    const msg = parseWebviewMessage(raw);
    if (!msg) return;
    try {
      switch (msg.type) {
        case 'ready':
          if (this.lastState) void from.postMessage(this.lastState);
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
    const commit = this.snapshot?.commits.find((c) => c.hash === hash || c.hash.startsWith(hash));
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
