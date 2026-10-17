// YALNIZCA dev önizlemesi: GitHub durum bandının tüm durumları.
// URL: ?theme=dark|light  ?gh=off|dismissed|connecting|connected|limit|stale|offline|ratelimited|notGitHub|noRemote|error  ?width=360
import '../src/webview/base.css';
import '../src/webview/panel.css';
import type { GitHubData, GitHubStatus, PullRequest } from '../src/types';
import type { WebviewToExtension } from '../src/protocol';
import { conflictFiles, renderGitHubBanner } from '../src/webview/githubBanner';

const params = new URLSearchParams(location.search);
document.body.className = params.get('theme') === 'light' ? 'vscode-light' : 'vscode-dark';
const width = Number(params.get('width'));
if (width > 0) document.body.style.setProperty('width', `${width}px`);

const NOW = Date.now();
const MIN = 60_000;
const pr = (n: number, files: string[]): PullRequest => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/ornek/gitatlas-revrev/pull/${n}`,
  author: 'mert',
  headRef: `feature/${n}`,
  baseRef: 'main',
  isDraft: false,
  updatedAt: NOW,
  files,
  ci: 'success',
});
const PRS = [pr(41, ['src/a.ts', 'src/b.ts']), pr(42, ['src/a.ts']), pr(43, ['README.md'])];
const resetAt = new Date(NOW + 40 * MIN).setSeconds(0, 0);

const STATES: Record<string, GitHubStatus> = {
  off: { state: 'off', dismissed: false },
  dismissed: { state: 'off', dismissed: true },
  connecting: { state: 'connecting' },
  connected: { state: 'connected', repo: 'ornek/gitatlas-revrev', fetchedAt: NOW - 3 * MIN, intervalMin: 2, baseIntervalMin: 2, rateLimit: { remaining: 4800, limit: 5000, resetAt } },
  limit: { state: 'connected', repo: 'ornek/gitatlas-revrev', fetchedAt: NOW - 1 * MIN, intervalMin: 10, baseIntervalMin: 2, rateLimit: { remaining: 112, limit: 5000, resetAt } },
  stale: { state: 'stale', repo: 'ornek/gitatlas-revrev', fetchedAt: NOW - 3 * 60 * MIN, reason: 'sessionExpired' },
  offline: { state: 'stale', repo: 'ornek/gitatlas-revrev', fetchedAt: NOW - 25 * MIN, reason: 'offline' },
  ratelimited: { state: 'stale', repo: 'ornek/gitatlas-revrev', fetchedAt: NOW - 50 * MIN, reason: 'rateLimited', rateLimit: { remaining: 0, limit: 5000, resetAt } },
  notGitHub: { state: 'notGitHub', remoteUrl: 'gitlab.com/ornek/gitatlas-revrev' },
  noRemote: { state: 'noRemote' },
  error: { state: 'error', message: 'GraphQL isteği 502 döndü.' },
};

const logEl = document.getElementById('log') as HTMLElement;
const post = (msg: WebviewToExtension): void => {
  const line = document.createElement('div');
  line.textContent = `post ${JSON.stringify(msg)}`;
  logEl.prepend(line);
};

const list = document.getElementById('list') as HTMLElement;
const only = params.get('gh');
for (const [name, status] of Object.entries(STATES)) {
  if (only && only !== name) continue;
  const data: GitHubData = { status, pullRequests: PRS, branchCi: [] };
  const label = document.createElement('div');
  label.className = 'rr-p-heading dev-label';
  label.textContent = name;
  const host = document.createElement('div');
  renderGitHubBanner(host, data, post);
  if (host.hidden) {
    const note = document.createElement('div');
    note.className = 'rr-p-muted';
    note.textContent = '(gizli — bant gösterilmez)';
    list.append(label, note);
  } else {
    list.append(label, host);
  }
}
const conflicts = [...conflictFiles(PRS).entries()].map(([f, n]) => `${f}:${n}`).join(', ');
const line = document.createElement('div');
line.textContent = `conflictFiles → ${conflicts}`;
logEl.prepend(line);
