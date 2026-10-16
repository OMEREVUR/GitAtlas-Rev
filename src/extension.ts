import * as vscode from 'vscode';
import { HeatDecorationProvider } from './decorations/heatDecorations';
import { GitHubLayer } from './github/githubLayer';
import { BranchView } from './panel/branchTree';
import { GIT_SCHEME, GitContentProvider } from './panel/gitContentProvider';
import { RewiewRevPanelProvider } from './panel/panelProvider';
import { RewiewRevStatusBar } from './panel/statusBar';

export function activate(context: vscode.ExtensionContext): void {
  const storageDir = context.globalStorageUri.fsPath;
  const decorations = new HeatDecorationProvider();
  const statusBar = new RewiewRevStatusBar();
  const github = new GitHubLayer(storageDir, context.workspaceState);
  const panel = new RewiewRevPanelProvider(context.extensionUri, storageDir, decorations, statusBar, github);
  const branches = new BranchView();

  context.subscriptions.push(
    decorations,
    statusBar,
    github,
    panel,
    branches,
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.workspace.registerTextDocumentContentProvider(GIT_SCHEME, new GitContentProvider()),
    vscode.window.registerWebviewViewProvider(RewiewRevPanelProvider.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewPanelSerializer(RewiewRevPanelProvider.editorViewType, panel),
    vscode.commands.registerCommand('rewiewrev.refresh', () => panel.reload()),
    vscode.commands.registerCommand('rewiewrev.openInEditor', () => panel.openInEditor()),
    vscode.commands.registerCommand('rewiewrev.refreshBranches', () => panel.refreshRefs()),
    vscode.commands.registerCommand('rewiewrev.github.connect', () => {
      const st = github.data.status;
      if (st.state === 'noRemote' || st.state === 'notGitHub') {
        const where = st.state === 'notGitHub' ? `origin (${st.remoteUrl}) bir GitHub reposu değil` : 'Bu repoda origin remote yok';
        void vscode.window.showInformationMessage(`RewiewRev: ${where}; GitHub katmanı kullanılamıyor.`);
        return;
      }
      return github.connect();
    }),
    vscode.commands.registerCommand('rewiewrev.github.refresh', () => github.refresh()),
    // Branch'ler paneli ↔ harita/graph: seçilen branch'in dokunduğu dosyalar haritada yanar.
    panel.onDidLoadRefs((refs) => branches.update(refs, refs ? undefined : 'Git reposu bulunamadı.')),
    branches.onDidSelectBranch((ref) => panel.selectBranch(ref?.name)),
    // GitHub PR/CI bilgisi Branch'ler ağacında da görünsün (panel bağlantısını panel kendisi kuruyor).
    github.onDidChange((d) => branches.setGitHub(d.pullRequests, d.branchCi)),
  );
  branches.setGitHub(github.data.pullRequests, github.data.branchCi);

  // HEAD veya ref'ler değişince (commit, checkout, pull, reset) otomatik yenile.
  let watchers: vscode.Disposable[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleReload = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void panel.reload();
    }, 500);
  };
  context.subscriptions.push(
    panel.onDidResolveRoot((root) => {
      watchers.forEach((w) => w.dispose());
      const base = vscode.Uri.file(root);
      watchers = ['.git/HEAD', '.git/refs/**'].map((glob) => {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, glob));
        w.onDidChange(scheduleReload);
        w.onDidCreate(scheduleReload);
        w.onDidDelete(scheduleReload);
        return w;
      });
    }),
    {
      dispose: () => {
        watchers.forEach((w) => w.dispose());
        if (timer) clearTimeout(timer);
      },
    },
  );

  // Panel kapalıyken de Explorer rozetleri dolsun.
  void panel.reload();
}

export function deactivate(): void {}
