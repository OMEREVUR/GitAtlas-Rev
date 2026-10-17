// vscode import yok; fetch enjekte edilir. Token hiçbir mesaja/loga girmez.
import type { CiState, Mergeable, MergeMethod, PrCheck, PrPanelData, PullRequestDetail, ReviewDecision } from '../types';
import {
  GitHubApiError,
  graphqlRequest,
  NETWORK_MESSAGE,
  parseRateLimit,
  rateLimitFromHeaders,
  throwForStatus,
  throwGraphqlErrors,
  toCi,
} from './graphql';

const API = 'https://api.github.com';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function nodes(v: unknown): unknown[] {
  const n = rec(v).nodes;
  return Array.isArray(n) ? n : [];
}

// ---- GraphQL: PR paneli ----

const PR_FIELDS = `
  number title url isDraft updatedAt
  author { login }
  headRefName baseRefName body mergeable reviewDecision isCrossRepository
  additions deletions changedFiles
  files(first: 100) { nodes { path } }
  commits(last: 1) { nodes { commit { statusCheckRollup {
    state
    contexts(first: 30) { nodes {
      ... on CheckRun { name conclusion status detailsUrl }
      ... on StatusContext { context state targetUrl }
    } }
  } } } }`;

/** Panel sorgusu; branch verilmezse mevcut branch'in PR'ı sorulmaz. */
export function prPanelQuery(withBranch: boolean): string {
  return `query RewiewRevPrPanel($owner: String!, $name: String!, $mineQuery: String!, $reviewQuery: String!${withBranch ? ', $branch: String!' : ''}) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    ${withBranch ? `current: pullRequests(states: OPEN, headRefName: $branch, first: 1) { nodes { ${PR_FIELDS} } }` : ''}
  }
  mine: search(query: $mineQuery, type: ISSUE, first: 30) { nodes { ... on PullRequest { ${PR_FIELDS} } } }
  review: search(query: $reviewQuery, type: ISSUE, first: 30) { nodes { ... on PullRequest { ${PR_FIELDS} } } }
  rateLimit { remaining limit resetAt }
}`;
}

/** Yalnızca github.com ayrıntı adresleri tutulur (webview yalnızca onları açar). */
function githubUrl(v: unknown): string | undefined {
  const s = str(v);
  return s.startsWith('https://github.com/') ? s : undefined;
}

function checkRunState(status: string, conclusion: string): CiState {
  if (status !== '' && status !== 'COMPLETED') return 'pending';
  switch (conclusion) {
    case 'SUCCESS':
      return 'success';
    case 'NEUTRAL':
    case 'SKIPPED':
      return 'none';
    case '':
      return 'pending';
    default:
      // FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE, STALE
      return 'failure';
  }
}

function parseCheck(v: unknown): PrCheck | undefined {
  const c = rec(v);
  let check: PrCheck;
  if (typeof c.name === 'string') {
    check = { name: c.name, state: checkRunState(str(c.status), str(c.conclusion)) };
    const url = githubUrl(c.detailsUrl);
    if (url) check.url = url;
  } else if (typeof c.context === 'string') {
    check = { name: c.context, state: toCi({ state: c.state }) };
    const url = githubUrl(c.targetUrl);
    if (url) check.url = url;
  } else {
    return undefined;
  }
  return check;
}

const MERGEABLE: Record<string, Mergeable> = { MERGEABLE: 'mergeable', CONFLICTING: 'conflicting' };
const REVIEW: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changesRequested',
  REVIEW_REQUIRED: 'reviewRequired',
};

function parsePrDetail(v: unknown, reviewRequested: boolean): PullRequestDetail | undefined {
  const p = rec(v);
  if (typeof p.number !== 'number') return undefined;
  const updatedAt = Date.parse(str(p.updatedAt));
  const rollup = rec(rec(rec(nodes(p.commits)[0]).commit).statusCheckRollup);
  return {
    number: p.number,
    title: str(p.title),
    url: str(p.url),
    author: str(rec(p.author).login, 'ghost'),
    headRef: str(p.headRefName),
    baseRef: str(p.baseRefName),
    isDraft: p.isDraft === true,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    files: nodes(p.files)
      .map((f) => str(rec(f).path))
      .filter((f) => f !== ''),
    ci: toCi(rollup),
    body: str(p.body),
    mergeable: MERGEABLE[str(p.mergeable)] ?? 'unknown',
    reviewDecision: REVIEW[str(p.reviewDecision)] ?? 'none',
    reviewRequested,
    isCrossRepository: p.isCrossRepository === true,
    additions: num(p.additions),
    deletions: num(p.deletions),
    changedFiles: num(p.changedFiles),
    checks: nodes(rollup.contexts)
      .map(parseCheck)
      .filter((c): c is PrCheck => c !== undefined),
  };
}

/** Panel GraphQL yanıtını güvenli biçimde daraltır; "errors" varsa GitHubApiError. */
export function parsePrPanelResponse(json: unknown, now = Date.now()): PrPanelData {
  const root = rec(json);
  const data = rec(root.data);
  throwGraphqlErrors(root, parseRateLimit(data.rateLimit));
  if (!isRecord(data.repository)) throw new GitHubApiError('notFound', "GitHub'da depo bulunamadı ya da erişim izni yok.");
  const repo = data.repository;

  const reviewList = nodes(rec(data.review))
    .map((n) => parsePrDetail(n, true))
    .filter((p): p is PullRequestDetail => p !== undefined);
  const reviewSet = new Set(reviewList.map((p) => p.number));
  const mine = nodes(rec(data.mine))
    .map((n) => parsePrDetail(n, false))
    .filter((p): p is PullRequestDetail => p !== undefined)
    .map((p) => (reviewSet.has(p.number) ? { ...p, reviewRequested: true } : p));

  const mergeMethods: MergeMethod[] = [];
  if (repo.mergeCommitAllowed === true) mergeMethods.push('merge');
  if (repo.squashMergeAllowed === true) mergeMethods.push('squash');
  if (repo.rebaseMergeAllowed === true) mergeMethods.push('rebase');

  const panel: PrPanelData = {
    viewer: str(rec(data.viewer).login),
    defaultBranch: str(rec(repo.defaultBranchRef).name, 'main'),
    mergeMethods,
    mine,
    reviewRequested: reviewList,
    fetchedAt: now,
  };
  const currentNode = nodes(repo.current)[0];
  if (currentNode !== undefined) {
    const current = parsePrDetail(currentNode, false);
    if (current) panel.currentBranchPr = { ...current, reviewRequested: reviewSet.has(current.number) };
  }
  return panel;
}

/** PR paneli verisi: benim PR'larım, review istenenler, mevcut branch'in PR'ı, izinli merge yöntemleri. */
export async function fetchPrPanel(
  token: string,
  owner: string,
  repo: string,
  currentBranch: string | undefined,
  fetchFn: typeof fetch,
): Promise<PrPanelData> {
  const scope = `repo:${owner}/${repo} is:pr is:open`;
  const variables: Record<string, unknown> = {
    owner,
    name: repo,
    mineQuery: `${scope} author:@me`,
    reviewQuery: `${scope} review-requested:@me`,
  };
  if (currentBranch) variables.branch = currentBranch;
  const { json } = await graphqlRequest(token, prPanelQuery(Boolean(currentBranch)), variables, fetchFn);
  return parsePrPanelResponse(json);
}

// ---- REST ----

interface RestResult {
  res: Response;
  json: unknown;
}

async function rest(token: string, method: string, url: string, body: unknown, fetchFn: typeof fetch): Promise<RestResult> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'rewiewrev-vscode',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new GitHubApiError('network', NETWORK_MESSAGE);
  }
  let json: unknown;
  try {
    const text = await res.text();
    json = text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    json = undefined;
  }
  return { res, json };
}

/** GitHub hata gövdesindeki message + errors[].message birleşimi. */
function githubMessage(json: unknown): string {
  const r = rec(json);
  const parts = [str(r.message)];
  if (Array.isArray(r.errors)) for (const e of r.errors) parts.push(typeof e === 'string' ? e : str(rec(e).message));
  return parts.filter((p) => p !== '').join(' — ');
}

function repoPath(owner: string, repo: string): string {
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  input: { title: string; body: string; head: string; base: string; draft: boolean },
  fetchFn: typeof fetch,
): Promise<{ number: number; url: string }> {
  const { res, json } = await rest(token, 'POST', `${repoPath(owner, repo)}/pulls`, input, fetchFn);
  if (res.status === 422) {
    const msg = githubMessage(json);
    if (/already exists/i.test(msg)) throw new GitHubApiError('other', 'Bu branch için zaten açık bir PR var.');
    if (/No commits between/i.test(msg)) throw new GitHubApiError('other', 'PR açılamadı: base ile head arasında fark yok.');
    throw new GitHubApiError('other', `PR açılamadı: ${msg || 'GitHub isteği reddetti.'}`);
  }
  throwForStatus(res, rateLimitFromHeaders(res.headers));
  const r = rec(json);
  if (typeof r.number !== 'number') throw new GitHubApiError('other', 'GitHub yanıtı beklenmedik biçimde.');
  return { number: r.number, url: str(r.html_url) };
}

export async function mergePullRequest(
  token: string,
  owner: string,
  repo: string,
  number: number,
  method: MergeMethod,
  fetchFn: typeof fetch,
): Promise<{ sha: string }> {
  const { res, json } = await rest(token, 'PUT', `${repoPath(owner, repo)}/pulls/${number}/merge`, { merge_method: method }, fetchFn);
  const msg = githubMessage(json);
  if (res.status === 405) {
    throw new GitHubApiError(
      'other',
      `PR birleştirilemedi: check'ler, zorunlu onaylar ya da çakışma engelliyor olabilir.${msg ? ` (GitHub: ${msg})` : ''}`,
    );
  }
  if (res.status === 409) throw new GitHubApiError('other', "PR'ın head'i değişti, yenileyip tekrar deneyin.");
  if (res.status === 422) throw new GitHubApiError('other', `PR birleştirilemedi.${msg ? ` (GitHub: ${msg})` : ''}`);
  throwForStatus(res, rateLimitFromHeaders(res.headers));
  return { sha: str(rec(json).sha) };
}

export async function deleteRemoteBranch(token: string, owner: string, repo: string, branch: string, fetchFn: typeof fetch): Promise<void> {
  const ref = branch.split('/').map(encodeURIComponent).join('/');
  const { res } = await rest(token, 'DELETE', `${repoPath(owner, repo)}/git/refs/heads/${ref}`, undefined, fetchFn);
  // Zaten silinmiş: başarı say.
  if (res.status === 422 || res.status === 404) return;
  throwForStatus(res, rateLimitFromHeaders(res.headers));
}
