import * as vscode from 'vscode';
import { HeatDecorationProvider } from './decorations/heatDecorations';
import { GitHubLayer } from './github/githubLayer';
import { BranchView, branchCommandHandlers } from './panel/branchTree';
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
    // Sebebe göre: bağlan / "GitHub'da yayınla" önerisi / GitHub dışı remote / ayar kapalı.
    vscode.commands.registerCommand('rewiewrev.github.connect', () => panel.connectGitHub()),
    vscode.commands.registerCommand('rewiewrev.github.refresh', () => github.refresh()),
    // Branch'ler paneli ↔ harita/graph: seçilen branch'in dokunduğu dosyalar haritada yanar.
    panel.onDidLoadRefs((refs) => branches.update(refs, refs ? undefined : 'Git reposu bulunamadı.')),
    branches.onDidSelectBranch((ref) => panel.selectBranch(ref?.name)),
    // GitHub PR/CI bilgisi Branch'ler ağacında da görünsün (panel bağlantısını panel kendisi kuruyor).
    github.onDidChange((d) => branches.setGitHub(d.pullRequests, d.branchCi)),
  );
  branches.setGitHub(github.data.pullRequests, github.data.branchCi);

  // v5: git işlemleri komut paletinden ve Branch'ler ağacının sağ tık menüsünden.
  const branchCmds = branchCommandHandlers(panel, branches);
  context.subscriptions.push(
    vscode.commands.registerCommand('rewiewrev.git.fetch', () => panel.runOp({ kind: 'fetch' })),
    vscode.commands.registerCommand('rewiewrev.git.pull', () => panel.runOp({ kind: 'pull' })),
    vscode.commands.registerCommand('rewiewrev.git.push', () => panel.runOp({ kind: 'push' })),
    vscode.commands.registerCommand('rewiewrev.git.commit', async () => {
      const staged = panel.workingTreeStatus?.files.filter((f) => f.staged).length ?? 0;
      if (staged === 0) {
        void vscode.window.showInformationMessage(
          "RewiewRev: Commit'e eklenmiş dosya yok. RewiewRev panelindeki Değişiklikler sekmesinden dosya seçin.",
        );
        return;
      }
      const message = await vscode.window.showInputBox({
        title: `Commit oluştur (${staged} dosya)`,
        prompt: 'Commit mesajı (özet)',
        placeHolder: 'feat: …',
        validateInput: (v) => (v.trim() ? undefined : 'Bir özet yazın.'),
      });
      if (message?.trim()) await panel.runOp({ kind: 'commit', message: message.trim(), amend: false, push: false });
    }),
    vscode.commands.registerCommand('rewiewrev.showGitOutput', () => panel.showGitOutput()),
    vscode.commands.registerCommand('rewiewrev.branch.checkout', (a: unknown) => branchCmds.checkout(a)),
    vscode.commands.registerCommand('rewiewrev.branch.create', (a: unknown) => branchCmds.create(a)),
    vscode.commands.registerCommand('rewiewrev.branch.merge', (a: unknown) => branchCmds.merge(a)),
    vscode.commands.registerCommand('rewiewrev.branch.rename', (a: unknown) => branchCmds.rename(a)),
    vscode.commands.registerCommand('rewiewrev.branch.delete', (a: unknown) => branchCmds.delete(a)),
  );

  // Eşitleme çubuğundaki branch adı ve "Yeni branch" düğmesi.
  const showBranchMenu = async (): Promise<void> => {
    const head = branches.branches.find((r) => r.isHead);
    type Item = vscode.QuickPickItem & { action: 'create' | 'switch'; name?: string };
    const toItem = (r: (typeof branches.branches)[number]): Item => ({
      label: `$(${r.kind === 'remote' ? 'cloud' : 'git-branch'}) ${r.name}`,
      description: r.subject,
      action: 'switch',
      name: r.name,
    });
    const items: Item[] = [
      { label: '$(add) Yeni branch oluştur…', description: head ? `kaynak: ${head.name}` : undefined, action: 'create' },
      { label: 'Lokal', kind: vscode.QuickPickItemKind.Separator, action: 'switch' },
      ...branches.branches.filter((r) => r.kind === 'local' && !r.isHead).map(toItem),
      { label: 'Remote', kind: vscode.QuickPickItemKind.Separator, action: 'switch' },
      ...branches.branches.filter((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD')).map(toItem),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: head ? `Şu anki branch: ${head.name}` : 'Branch',
      placeHolder: 'Geçmek istediğin branch ya da yeni branch',
      matchOnDescription: true,
    });
    if (!picked) return;
    if (picked.action === 'create') await branchCmds.create(undefined);
    else if (picked.name) await panel.runOp({ kind: 'checkout', branch: picked.name });
  };
  context.subscriptions.push(
    panel.onDidRequestBranchAction((action) => (action === 'create' ? branchCmds.create(undefined) : showBranchMenu())),
  );

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
