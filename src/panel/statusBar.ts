import * as vscode from 'vscode';
import { panelText } from '../i18n/panel';
import type { GitHubData } from '../types';
import { formatRelative } from '../webview/format';

function staleReason(reason: 'sessionExpired' | 'offline' | 'rateLimited'): string {
  const t = panelText();
  return reason === 'sessionExpired' ? t.staleSessionExpired : reason === 'offline' ? t.staleOffline : t.staleRateLimited;
}

/** Durum çubuğu metnine eklenecek GitHub parçası ve tooltip ayrıntısı; gösterilecek bir şey yoksa undefined. */
export function githubStatusText(data: GitHubData | undefined, now: number): { suffix: string; detail: string } | undefined {
  if (!data) return undefined;
  const t = panelText();
  const s = data.status;
  const n = data.pullRequests.length;
  switch (s.state) {
    case 'connected': {
      let detail = t.ghConnectedDetail(s.repo, n, formatRelative(s.fetchedAt, now));
      if (s.intervalMin > s.baseIntervalMin) detail += t.ghRateLow(s.intervalMin);
      if (s.rateLimit) detail += t.ghRemaining(s.rateLimit.remaining, s.rateLimit.limit);
      return { suffix: t.ghConnected(n), detail };
    }
    case 'stale':
      return {
        suffix: t.ghStale,
        detail: t.ghStaleDetail(staleReason(s.reason), s.repo, formatRelative(s.fetchedAt, now)),
      };
    case 'connecting':
      return { suffix: t.ghConnecting, detail: t.ghConnectingDetail };
    case 'error':
      return { suffix: t.ghError, detail: `GitHub: ${s.message}` };
    default:
      return undefined;
  }
}

export class GitAtlasRevRevStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private baseText = '';
  private baseTooltip = '';
  private github: GitHubData | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem('gitatlas-revrev.status', vscode.StatusBarAlignment.Left, 0);
    this.item.name = 'GitAtlas-RevRev';
    this.item.command = { title: panelText().openPanel, command: 'gitatlas-revrev.panel.focus' };
  }

  /** progress 0..1 */
  setScanning(progress: number): void {
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    const t = panelText();
    this.set(`$(sync~spin) ${t.scanning(pct)}`, t.scanningTooltip);
  }

  setReady(fileCount: number, fromCache: boolean): void {
    const t = panelText();
    this.set(`$(flame) ${t.ready(fromCache)}`, t.readyTooltip(fileCount));
  }

  setError(text: string): void {
    const t = panelText();
    this.set(`$(warning) ${t.errorText(text)}`, t.errorTooltip(text));
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
