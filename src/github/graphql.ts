import type { BranchCi, CiState, PullRequest, RateLimitInfo } from '../types';

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

export const PULLS_QUERY = `query GitAtlasRevRevPulls($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        isDraft
        updatedAt
        author { login }
        headRefName
        baseRefName
        files(first: 100) { nodes { path } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
    refs(refPrefix: "refs/heads/", first: 50, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
      nodes {
        name
        target { ... on Commit { statusCheckRollup { state } } }
      }
    }
  }
  rateLimit { remaining limit resetAt }
}`;

export type GitHubApiErrorKind = 'unauthorized' | 'rateLimited' | 'notFound' | 'network' | 'other';

export class GitHubApiError extends Error {
  readonly kind: GitHubApiErrorKind;
  readonly rateLimit?: RateLimitInfo;

  constructor(kind: GitHubApiErrorKind, message: string, rateLimit?: RateLimitInfo) {
    super(message);
    this.name = 'GitHubApiError';
    this.kind = kind;
    if (rateLimit) this.rateLimit = rateLimit;
  }
}

export interface PullsResult {
  pullRequests: PullRequest[];
  branchCi: BranchCi[];
  rateLimit?: RateLimitInfo;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function nodes(v: unknown): unknown[] {
  const n = rec(v).nodes;
  return Array.isArray(n) ? n : [];
}

export function toCi(rollup: unknown): CiState {
  switch (rec(rollup).state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

export function parseRateLimit(v: unknown): RateLimitInfo | undefined {
  const r = rec(v);
  if (typeof r.remaining !== 'number' || typeof r.limit !== 'number') return undefined;
  const resetAt = Date.parse(str(r.resetAt));
  return { remaining: r.remaining, limit: r.limit, resetAt: Number.isFinite(resetAt) ? resetAt : 0 };
}

function parsePull(v: unknown): PullRequest | undefined {
  const p = rec(v);
  if (typeof p.number !== 'number') return undefined;
  const updatedAt = Date.parse(str(p.updatedAt));
  const lastCommit = rec(nodes(p.commits)[0]).commit;
  return {
    number: p.number,
    title: str(p.title),
    url: str(p.url),
    // Silinmiş hesaplar null gelir.
    author: str(rec(p.author).login, 'ghost'),
    headRef: str(p.headRefName),
    baseRef: str(p.baseRefName),
    isDraft: p.isDraft === true,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    files: nodes(p.files)
      .map((f) => str(rec(f).path))
      .filter((f) => f !== ''),
    ci: toCi(rec(lastCommit).statusCheckRollup),
  };
}

/** GraphQL "errors" alanı varsa sınıflandırıp GitHubApiError fırlatır. */
export function throwGraphqlErrors(root: Record<string, unknown>, rateLimit?: RateLimitInfo): void {
  if (Array.isArray(root.errors) && root.errors.length > 0) {
    const first = rec(root.errors[0]);
    const type = str(first.type);
    const message = str(first.message, 'bilinmeyen hata');
    if (type === 'RATE_LIMITED') throw new GitHubApiError('rateLimited', 'GitHub istek limiti doldu.', rateLimit);
    if (type === 'NOT_FOUND') throw new GitHubApiError('notFound', `GitHub'da depo bulunamadı ya da erişim izni yok: ${message}`, rateLimit);
    if (type === 'FORBIDDEN') throw new GitHubApiError('unauthorized', `GitHub erişimi reddedildi: ${message}`, rateLimit);
    throw new GitHubApiError('other', `GitHub API hatası: ${message}`, rateLimit);
  }
}

/** GraphQL yanıtını güvenli biçimde daraltır; "errors" varsa GitHubApiError fırlatır. */
export function parsePullsResponse(json: unknown): PullsResult {
  const root = rec(json);
  const data = rec(root.data);
  const rateLimit = parseRateLimit(data.rateLimit);
  throwGraphqlErrors(root, rateLimit);
  if (!isRecord(data.repository)) throw new GitHubApiError('notFound', "GitHub'da depo bulunamadı ya da erişim izni yok.", rateLimit);
  const repo = data.repository;
  const pullRequests = nodes(repo.pullRequests)
    .map(parsePull)
    .filter((p): p is PullRequest => p !== undefined);
  const branchCi: BranchCi[] = [];
  for (const n of nodes(repo.refs)) {
    const r = rec(n);
    const branch = str(r.name);
    if (branch !== '') branchCi.push({ branch, ci: toCi(rec(r.target).statusCheckRollup) });
  }
  return rateLimit ? { pullRequests, branchCi, rateLimit } : { pullRequests, branchCi };
}

export function rateLimitFromHeaders(headers: Headers): RateLimitInfo | undefined {
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const limit = Number(headers.get('x-ratelimit-limit'));
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-remaining') === null || !Number.isFinite(remaining)) return undefined;
  return {
    remaining,
    limit: Number.isFinite(limit) ? limit : 0,
    resetAt: Number.isFinite(reset) ? reset * 1000 : 0,
  };
}

export const NETWORK_MESSAGE = "GitHub'a ulaşılamadı. İnternet bağlantısını kontrol edin.";

/** GraphQL ve REST için ortak HTTP durum eşlemesi (401/403/429/404/diğer). */
export function throwForStatus(res: Response, rateLimit: RateLimitInfo | undefined): void {
  if (res.status === 401) throw new GitHubApiError('unauthorized', 'GitHub oturumu geçersiz ya da süresi doldu.', rateLimit);
  if ((res.status === 403 || res.status === 429) && (rateLimit?.remaining === 0 || res.status === 429)) {
    throw new GitHubApiError('rateLimited', 'GitHub istek limiti doldu.', rateLimit);
  }
  if (res.status === 403) throw new GitHubApiError('unauthorized', 'GitHub erişimi reddedildi (izin ya da SSO yetkisi eksik olabilir).', rateLimit);
  if (res.status === 404) throw new GitHubApiError('notFound', "GitHub'da depo bulunamadı ya da erişim izni yok.", rateLimit);
  if (!res.ok) throw new GitHubApiError('other', `GitHub isteği başarısız oldu (HTTP ${res.status}).`, rateLimit);
}

/** GraphQL isteği; HTTP hatalarını GitHubApiError'a çevirir, ham JSON'u döner ("errors" kontrolü çağırana kalır). */
export async function graphqlRequest(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<{ json: unknown; rateLimit?: RateLimitInfo }> {
  let res: Response;
  try {
    res = await fetchFn(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'gitatlas-revrev-vscode',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new GitHubApiError('network', NETWORK_MESSAGE);
  }
  const rateLimit = rateLimitFromHeaders(res.headers);
  throwForStatus(res, rateLimit);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new GitHubApiError('network', 'GitHub yanıtı okunamadı.');
  }
  return rateLimit ? { json, rateLimit } : { json };
}

/** Açık PR'lar, branch CI'ları ve limit tek GraphQL isteğiyle. */
export async function fetchPulls(token: string, owner: string, repo: string, fetchFn: typeof fetch): Promise<PullsResult> {
  const { json, rateLimit } = await graphqlRequest(token, PULLS_QUERY, { owner, name: repo }, fetchFn);
  const result = parsePullsResponse(json);
  if (!result.rateLimit && rateLimit) result.rateLimit = rateLimit;
  return result;
}
