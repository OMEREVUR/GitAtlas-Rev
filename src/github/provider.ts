import type { CiState, PullRequest } from '../types';
import { GitHubApiError, fetchPulls } from './graphql';
import type { PullsResult } from './graphql';

/** Raporun provider soyutlaması; ileride GitLab vb. aynı arayüzü uygular. */
export interface RemoteProvider {
  readonly id: 'github';
  isAvailable(): Promise<boolean>;
  getOpenPullRequests(): Promise<PullRequest[]>;
  getBranchStatus(branch: string): Promise<CiState>;
}

const SHARE_MS = 10_000;

export class GitHubProvider implements RemoteProvider {
  readonly id = 'github' as const;
  private shared?: { at: number; promise: Promise<PullsResult> };

  constructor(
    readonly owner: string,
    readonly repo: string,
    private readonly getToken: () => Promise<string | undefined>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async isAvailable(): Promise<boolean> {
    return (await this.getToken()) !== undefined;
  }

  /** Tek GraphQL isteği; sonuç ≈10 sn paylaşılır. force: paylaşılanı atla. */
  fetchAll(force = false): Promise<PullsResult> {
    const now = Date.now();
    if (!force && this.shared && now - this.shared.at < SHARE_MS) return this.shared.promise;
    const promise = this.load();
    const entry = { at: now, promise };
    this.shared = entry;
    // Hata paylaşılmaz: bir sonraki çağrı yeniden dener.
    promise.catch(() => {
      if (this.shared === entry) this.shared = undefined;
    });
    return promise;
  }

  async getOpenPullRequests(): Promise<PullRequest[]> {
    return (await this.fetchAll()).pullRequests;
  }

  async getBranchStatus(branch: string): Promise<CiState> {
    const { branchCi, pullRequests } = await this.fetchAll();
    const hit = branchCi.find((b) => b.branch === branch);
    if (hit) return hit.ci;
    return pullRequests.find((p) => p.headRef === branch)?.ci ?? 'none';
  }

  private async load(): Promise<PullsResult> {
    const token = await this.getToken();
    if (token === undefined) throw new GitHubApiError('unauthorized', 'GitHub oturumu yok.');
    return fetchPulls(token, this.owner, this.repo, this.fetchFn);
  }
}
