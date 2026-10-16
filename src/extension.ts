import * as vscode from 'vscode';
import { HeatDecorationProvider } from './decorations/heatDecorations';
import { GIT_SCHEME, GitContentProvider } from './panel/gitContentProvider';
import { RewiewRevPanelProvider } from './panel/panelProvider';
import { RewiewRevStatusBar } from './panel/statusBar';

export function activate(context: vscode.ExtensionContext): void {
  const storageDir = context.globalStorageUri.fsPath;
  const decorations = new HeatDecorationProvider();
  const statusBar = new RewiewRevStatusBar();
  const panel = new RewiewRevPanelProvider(context.extensionUri, storageDir, decorations, statusBar);

  context.subscriptions.push(
    decorations,
    statusBar,
    panel,
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.workspace.registerTextDocumentContentProvider(GIT_SCHEME, new GitContentProvider()),
    vscode.window.registerWebviewViewProvider(RewiewRevPanelProvider.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewPanelSerializer(RewiewRevPanelProvider.editorViewType, panel),
    vscode.commands.registerCommand('rewiewrev.refresh', () => panel.reload()),
    vscode.commands.registerCommand('rewiewrev.openInEditor', () => panel.openInEditor()),
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
