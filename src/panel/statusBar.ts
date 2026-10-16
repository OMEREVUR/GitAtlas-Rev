import * as vscode from 'vscode';
import type { GitHubData } from '../types';
import { formatRelative } from '../webview/format';

const STALE_REASON: Record<'sessionExpired' | 'offline' | 'rateLimited', string> = {
  sessionExpired: 'GitHub oturumu sona erdi',
  offline: 'GitHub\'a ulaşılamıyor',
  rateLimited: 'GitHub istek limiti doldu',
};

/** Durum çubuğu metnine eklenecek GitHub parçası ve tooltip ayrıntısı; gösterilecek bir şey yoksa undefined. */
export function githubStatusText(data: GitHubData | undefined, now: number): { suffix: string; detail: string } | undefined {
  if (!data) return undefined;
  const s = data.status;
  const n = data.pullRequests.length;
  switch (s.state) {
    case 'connected': {
      let detail = `GitHub: ${s.repo} · ${n} açık PR · ${formatRelative(s.fetchedAt, now)} güncellendi`;
      if (s.intervalMin > s.baseIntervalMin) detail += ` · istek limiti düşük, ${s.intervalMin} dk'da bir yenileniyor`;
      if (s.rateLimit) detail += ` · kalan istek ${s.rateLimit.remaining}/${s.rateLimit.limit}`;
      return { suffix: `GitHub: ${n} PR`, detail };
    }
    case 'stale':
      return {
        suffix: 'GitHub: eski veri',
        detail: `${STALE_REASON[s.reason]}. ${s.repo} için PR ve CI bilgileri ${formatRelative(s.fetchedAt, now)} alınmış hâliyle gösteriliyor.`,
      };
    case 'connecting':
      return { suffix: 'GitHub: bağlanıyor', detail: 'GitHub: açık PR\'lar ve CI sonuçları alınıyor…' };
    case 'error':
      return { suffix: 'GitHub: hata', detail: `GitHub: ${s.message}` };
    default:
      return undefined;
  }
}

export class RewiewRevStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private baseText = '';
  private baseTooltip = '';
  private github: GitHubData | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem('rewiewrev.status', vscode.StatusBarAlignment.Left, 0);
    this.item.name = 'RewiewRev';
    this.item.command = { title: 'RewiewRev panelini aç', command: 'rewiewrev.panel.focus' };
  }

  /** progress 0..1 */
  setScanning(progress: number): void {
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    this.set(`$(sync~spin) RewiewRev: taranıyor %${pct}`, 'RewiewRev git geçmişini tarıyor');
  }

  setReady(fileCount: number, fromCache: boolean): void {
    this.set(
      `$(flame) RewiewRev: tarama tamam · ${fromCache ? 'cache güncel' : 'güncellendi'}`,
      `RewiewRev: ${fileCount} dosya · haritayı açmak için tıklayın`,
    );
  }

  setError(text: string): void {
    this.set(`$(warning) RewiewRev: ${text}`, `RewiewRev: ${text} · ayrıntı için tıklayın`);
  }

  /** GitHub durumu; bağlıyken " · GitHub: N PR", eski veride " · GitHub: eski veri" eklenir. */
  setGitHub(data: GitHubData | undefined): void {
    this.github = data;
    this.render();
  }

  private set(text: string, tooltip: string): void {
    this.baseText = text;
    this.baseTooltip = tooltip;
    this.render();
  }

  private render(): void {
    if (!this.baseText) return;
    const gh = githubStatusText(this.github, Date.now());
    this.item.text = gh ? `${this.baseText} · ${gh.suffix}` : this.baseText;
    this.item.tooltip = gh ? `${this.baseTooltip}\n${gh.detail}` : this.baseTooltip;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
