import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { BranchCi, GitHubData, GitHubStatus, PullRequest, RateLimitInfo } from '../types';
import { GitHubApiError } from './graphql';
import { GitHubProvider } from './provider';
import { getOriginUrl, parseGitHubRemote, redactRemoteUrl } from './remote';

const CACHE_VERSION = 1;
const DISMISSED_KEY = 'rewiewrev.github.dismissed';
const SCOPES = ['repo'];
const MAX_SLOW_INTERVAL_MIN = 30;

interface CacheFile {
  version: number;
  fetchedAt: number;
  pullRequests: PullRequest[];
  branchCi: BranchCi[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPull(v: unknown): v is PullRequest {
  return isRecord(v) && typeof v.number === 'number' && typeof v.headRef === 'string' && Array.isArray(v.files) && typeof v.ci === 'string';
}

function isBranchCi(v: unknown): v is BranchCi {
  return isRecord(v) && typeof v.branch === 'string' && typeof v.ci === 'string';
}

/** Limit azaldıysa (kalan < %10) aralık 5 katı, en çok 30 dk; ayar 30'dan büyükse ayar kalır. */
export function effectiveIntervalMin(baseMin: number, rateLimit: RateLimitInfo | undefined, now = Date.now()): number {
  if (!rateLimit || rateLimit.limit <= 0 || now >= rateLimit.resetAt) return baseMin;
  if (rateLimit.remaining >= rateLimit.limit * 0.1) return baseMin;
  return Math.max(baseMin, Math.min(baseMin * 5, MAX_SLOW_INTERVAL_MIN));
}

/** GitHub katmanı: oturum, periyodik yenileme, cache ve durum makinesi. Token hiçbir yere yazılmaz. */
export class GitHubLayer implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<GitHubData>();
  readonly onDidChange: vscode.Event<GitHubData> = this.emitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private status: GitHubStatus = { state: 'off', dismissed: false };
  private pullRequests: PullRequest[] = [];
  private branchCi: BranchCi[] = [];
  private fetchedAt = 0;
  private rateLimit?: RateLimitInfo;

  private root?: string;
  private repoName?: string;
  private provider?: GitHubProvider;
  private session?: vscode.AuthenticationSession;
  private visible = false;
  private timer?: ReturnType<typeof setTimeout>;
  private inflight?: Promise<void>;
  /** setRoot/ayar değişince artar; eski async sonuçlar yok sayılır. */
  private generation = 0;

  constructor(
    private readonly storageDir: string,
    private readonly workspaceState: vscode.Memento,
  ) {
    this.disposables.push(
      this.emitter,
      vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === 'github') void this.onSessionsChanged();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('rewiewrev.github')) void this.onConfigChanged();
      }),
    );
  }

  get data(): GitHubData {
    const hasData = this.status.state === 'connected' || this.status.state === 'stale' || this.status.state === 'connecting';
    return {
      status: this.status,
      pullRequests: hasData ? this.pullRequests : [],
      branchCi: hasData ? this.branchCi : [],
    };
  }

  /** origin GitHub ise owner/repo. */
  get repoCoords(): { owner: string; repo: string } | undefined {
    return this.provider ? { owner: this.provider.owner, repo: this.provider.repo } : undefined;
  }

  /** PR işlemleri için token; yalnızca connected/stale iken, oturum açma penceresi açmadan. */
  async getToken(): Promise<string | undefined> {
    if (this.status.state !== 'connected' && this.status.state !== 'stale') return undefined;
    return (await this.silentSession())?.accessToken;
  }

  async setRoot(root: string | undefined): Promise<void> {
    const gen = ++this.generation;
    this.stopTimer();
    this.root = root;
    this.repoName = undefined;
    this.provider = undefined;
    this.inflight = undefined;
    this.resetData();

    if (!this.enabled() || root === undefined) {
      this.setStatus({ state: 'off', dismissed: false });
      return;
    }
    let url: string | undefined;
    try {
      url = await getOriginUrl(root);
    } catch {
      url = undefined;
    }
    if (gen !== this.generation) return;
    if (url === undefined) {
      this.setStatus({ state: 'noRemote' });
      return;
    }
    const gh = parseGitHubRemote(url);
    if (!gh) {
      this.setStatus({ state: 'notGitHub', remoteUrl: redactRemoteUrl(url) });
      return;
    }
    this.repoName = `${gh.owner}/${gh.repo}`;
    this.provider = new GitHubProvider(gh.owner, gh.repo, async () => this.session?.accessToken);

    const cache = await this.readCache();
    if (gen !== this.generation) return;
    if (cache) {
      this.pullRequests = cache.pullRequests;
      this.branchCi = cache.branchCi;
      this.fetchedAt = cache.fetchedAt;
    }

    this.session = await this.silentSession();
    if (gen !== this.generation) return;
    if (!this.session) {
      if (cache && !this.dismissed()) {
        this.setStatus({ state: 'stale', repo: this.repoName, fetchedAt: this.fetchedAt, reason: 'sessionExpired' });
      } else {
        this.setStatus({ state: 'off', dismissed: this.dismissed() });
      }
      return;
    }
    this.setStatus(cache ? this.connectedStatus() : { state: 'connecting' });
    await this.refresh();
  }

  async connect(): Promise<void> {
    if (!this.enabled() || !this.provider || !this.repoName) return;
    const gen = this.generation;
    const previous = this.status;
    this.setStatus({ state: 'connecting' });
    let session: vscode.AuthenticationSession | undefined;
    try {
      session = await vscode.authentication.getSession('github', SCOPES, { createIfNone: true });
    } catch {
      session = undefined;
    }
    if (gen !== this.generation) return;
    if (!session) {
      // İptal: veri varsa eski durumu koru.
      this.setStatus(previous.state === 'stale' ? previous : { state: 'off', dismissed: this.dismissed() });
      return;
    }
    this.session = session;
    await this.workspaceState.update(DISMISSED_KEY, false);
    await this.refresh();
  }

  dismiss(): void {
    void this.workspaceState.update(DISMISSED_KEY, true);
    this.stopTimer();
    this.setStatus({ state: 'off', dismissed: true });
  }

  refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.stopTimer();
      return;
    }
    this.schedule();
  }

  dispose(): void {
    this.generation++;
    this.stopTimer();
    for (const d of this.disposables) d.dispose();
  }

  // ---- iç işler ----

  private async doRefresh(): Promise<void> {
    const provider = this.provider;
    const repo = this.repoName;
    if (!this.enabled() || !provider || !repo) return;
    if (this.status.state === 'off' && this.status.dismissed) return;
    const gen = this.generation;
    this.stopTimer();
    if (!this.session) {
      this.session = await this.silentSession();
      if (gen !== this.generation) return;
      if (!this.session) {
        this.onSessionLost();
        return;
      }
    }
    try {
      const result = await provider.fetchAll(true);
      if (gen !== this.generation) return;
      this.pullRequests = result.pullRequests;
      this.branchCi = result.branchCi;
      this.fetchedAt = Date.now();
      this.rateLimit = result.rateLimit;
      this.setStatus(this.connectedStatus());
      void this.writeCache({ version: CACHE_VERSION, fetchedAt: this.fetchedAt, pullRequests: this.pullRequests, branchCi: this.branchCi });
    } catch (err) {
      if (gen !== this.generation) return;
      this.onFetchError(err, repo);
    }
    this.schedule();
  }

  private onFetchError(err: unknown, repo: string): void {
    const kind = err instanceof GitHubApiError ? err.kind : 'other';
    if (err instanceof GitHubApiError && err.rateLimit) this.rateLimit = err.rateLimit;
    switch (kind) {
      case 'unauthorized':
        this.session = undefined;
        this.onSessionLost();
        return;
      case 'rateLimited':
        this.setStatus({ state: 'stale', repo, fetchedAt: this.fetchedAt, reason: 'rateLimited', ...(this.rateLimit ? { rateLimit: this.rateLimit } : {}) });
        return;
      case 'network':
        this.setStatus({ state: 'stale', repo, fetchedAt: this.fetchedAt, reason: 'offline', ...(this.rateLimit ? { rateLimit: this.rateLimit } : {}) });
        return;
      default: {
        const message = err instanceof Error ? err.message : 'GitHub verisi alınamadı.';
        this.setStatus({ state: 'error', message });
      }
    }
  }

  private onSessionLost(): void {
    this.stopTimer();
    if (this.repoName && this.fetchedAt > 0) {
      this.setStatus({ state: 'stale', repo: this.repoName, fetchedAt: this.fetchedAt, reason: 'sessionExpired' });
    } else {
      this.setStatus({ state: 'off', dismissed: this.dismissed() });
    }
  }

  private async onSessionsChanged(): Promise<void> {
    if (!this.enabled() || !this.provider) return;
    const gen = this.generation;
    const session = await this.silentSession();
    if (gen !== this.generation) return;
    const had = this.session !== undefined;
    this.session = session;
    if (!session) {
      if (had) this.onSessionLost();
      return;
    }
    if (!had && !this.dismissed()) await this.refresh();
  }

  private async onConfigChanged(): Promise<void> {
    const enabled = this.enabled();
    const wasOff = this.provider === undefined && this.status.state === 'off';
    if (!enabled || wasOff) {
      await this.setRoot(this.root);
      return;
    }
    // Yalnızca aralık değişti.
    if (this.status.state === 'connected') this.setStatus(this.connectedStatus());
    this.schedule();
  }

  private connectedStatus(): GitHubStatus {
    const base = this.baseIntervalMin();
    return {
      state: 'connected',
      repo: this.repoName ?? '',
      fetchedAt: this.fetchedAt,
      intervalMin: effectiveIntervalMin(base, this.rateLimit),
      baseIntervalMin: base,
      ...(this.rateLimit ? { rateLimit: this.rateLimit } : {}),
    };
  }

  private schedule(): void {
    this.stopTimer();
    if (!this.visible || !this.session || !this.provider) return;
    const s = this.status;
    if (s.state !== 'connected' && !(s.state === 'stale' && s.reason !== 'sessionExpired')) return;
    const now = Date.now();
    const intervalMs = effectiveIntervalMin(this.baseIntervalMin(), this.rateLimit, now) * 60_000;
    let delay = Math.max(0, this.fetchedAt + intervalMs - now);
    if (s.state === 'stale') delay = intervalMs;
    if (s.state === 'stale' && s.reason === 'rateLimited' && this.rateLimit && this.rateLimit.resetAt > now) {
      delay = Math.max(delay, this.rateLimit.resetAt - now + 5_000);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setStatus(status: GitHubStatus): void {
    this.status = status;
    this.emitter.fire(this.data);
  }

  private resetData(): void {
    this.pullRequests = [];
    this.branchCi = [];
    this.fetchedAt = 0;
    this.rateLimit = undefined;
    this.session = undefined;
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('rewiewrev').get<boolean>('github.enabled', true) !== false;
  }

  private baseIntervalMin(): number {
    const v = vscode.workspace.getConfiguration('rewiewrev').get<number>('github.refreshInterval', 2);
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(60, Math.max(1, v)) : 2;
  }

  private dismissed(): boolean {
    return this.workspaceState.get<boolean>(DISMISSED_KEY, false) === true;
  }

  private async silentSession(): Promise<vscode.AuthenticationSession | undefined> {
    try {
      return await vscode.authentication.getSession('github', SCOPES, { createIfNone: false, silent: true });
    } catch {
      return undefined;
    }
  }

  private cacheFile(): string | undefined {
    if (!this.repoName) return undefined;
    const id = createHash('sha1').update(this.repoName).digest('hex').slice(0, 16);
    return join(this.storageDir, `github-${id}.json`);
  }

  private async readCache(): Promise<CacheFile | undefined> {
    const file = this.cacheFile();
    if (!file) return undefined;
    try {
      const data: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!isRecord(data) || data.version !== CACHE_VERSION || typeof data.fetchedAt !== 'number') return undefined;
      if (!Array.isArray(data.pullRequests) || !Array.isArray(data.branchCi)) return undefined;
      return {
        version: CACHE_VERSION,
        fetchedAt: data.fetchedAt,
        pullRequests: data.pullRequests.filter(isPull),
        branchCi: data.branchCi.filter(isBranchCi),
      };
    } catch {
      return undefined;
    }
  }

  private async writeCache(cache: CacheFile): Promise<void> {
    const file = this.cacheFile();
    if (!file) return;
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await mkdir(this.storageDir, { recursive: true });
      await writeFile(tmp, JSON.stringify(cache), 'utf8');
      await rename(tmp, file);
    } catch {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }
}
