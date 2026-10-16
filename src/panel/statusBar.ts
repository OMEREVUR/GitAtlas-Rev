import * as vscode from 'vscode';

export class RewiewRevStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('rewiewrev.status', vscode.StatusBarAlignment.Left, 0);
    this.item.name = 'RewiewRev';
    this.item.command = { title: 'RewiewRev panelini aç', command: 'rewiewrev.panel.focus' };
  }

  /** progress 0..1 */
  setScanning(progress: number): void {
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    this.item.text = `$(sync~spin) RewiewRev: taranıyor %${pct}`;
    this.item.tooltip = 'RewiewRev git geçmişini tarıyor';
    this.item.show();
  }

  setReady(fileCount: number, fromCache: boolean): void {
    this.item.text = `$(flame) RewiewRev: tarama tamam · ${fromCache ? 'cache güncel' : 'güncellendi'}`;
    this.item.tooltip = `RewiewRev: ${fileCount} dosya · haritayı açmak için tıklayın`;
    this.item.show();
  }

  setError(text: string): void {
    this.item.text = `$(warning) RewiewRev: ${text}`;
    this.item.tooltip = `RewiewRev: ${text} · ayrıntı için tıklayın`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
