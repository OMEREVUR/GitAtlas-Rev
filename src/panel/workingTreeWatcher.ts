import * as path from 'node:path';
import * as vscode from 'vscode';

const DEBOUNCE_MS = 300;

/** .git içinde çalışma ağacı durumunu etkileyen dosyalar. */
const GIT_RELEVANT = /^\.git\/(index|HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|ORIG_HEAD|packed-refs|refs\/.*|rebase-(merge|apply)(\/.*)?)$/;

/**
 * Repo köküne göre "/" ayraçlı yoldaki değişiklik durumu etkiler mi?
 * node_modules her yerde yok sayılır; .git içinde yalnızca index/HEAD/ref'ler/merge-rebase durumu sayılır
 * (.git/objects, kilit dosyaları vb. yok).
 */
export function isRelevantChange(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (p === '' || p.startsWith('../')) return false;
  if (p.split('/').includes('node_modules')) return false;
  if (p === '.git' || p.startsWith('.git/')) return GIT_RELEVANT.test(p);
  return true;
}

/** Çalışma ağacını ve .git durumunu izler; değişiklikleri 300 ms birleştirip onChange'i çağırır. */
export class WorkingTreeWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly root: string,
    private readonly onChange: () => void,
  ) {
    const base = vscode.Uri.file(root);
    const patterns = [
      '**/*',
      '.git/{index,HEAD,MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,ORIG_HEAD,packed-refs}',
      '.git/refs/**',
      '.git/rebase-{merge,apply}',
      '.git/rebase-{merge,apply}/**',
    ];
    for (const glob of patterns) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, glob));
      const handler = (uri: vscode.Uri): void => this.onFsEvent(uri);
      this.disposables.push(w, w.onDidChange(handler), w.onDidCreate(handler), w.onDidDelete(handler));
    }
    this.disposables.push(vscode.workspace.onDidSaveTextDocument((doc) => this.onFsEvent(doc.uri)));
  }

  private onFsEvent(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;
    if (!isRelevantChange(path.relative(this.root, uri.fsPath))) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.disposed) this.onChange();
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
