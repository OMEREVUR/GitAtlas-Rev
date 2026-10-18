import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runGit } from '../src/git/gitRunner';
import { prCheckoutCommands } from '../src/git/prCheckout';
import { createPullRequest, deleteRemoteBranch, fetchPrPanel, mergePullRequest, parsePrPanelResponse, prPanelQuery } from '../src/github/prApi';

function pr(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: false,
    updatedAt: '2026-10-15T10:00:00Z',
    author: { login: 'ayse' },
    headRefName: `feat/${number}`,
    baseRefName: 'main',
    body: 'açıklama',
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    isCrossRepository: false,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    files: { nodes: [{ path: 'src/a.ts' }] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'FAILURE',
              contexts: {
                nodes: [
                  { name: 'build', conclusion: 'SUCCESS', status: 'COMPLETED', detailsUrl: 'https://github.com/o/r/actions/runs/1' },
                  { name: 'test', conclusion: 'FAILURE', status: 'COMPLETED', detailsUrl: 'https://github.com/o/r/actions/runs/2' },
                  { name: 'lint', conclusion: null, status: 'IN_PROGRESS', detailsUrl: null },
                  { name: 'docs', conclusion: 'SKIPPED', status: 'COMPLETED' },
                  { context: 'ci/circleci', state: 'PENDING', targetUrl: 'https://circleci.com/x' },
                  { context: 'codecov', state: 'ERROR', targetUrl: 'https://github.com/o/r/checks' },
                  {},
                ],
              },
            },
          },
        },
      ],
    },
    ...extra,
  };
}

function panelResponse(withCurrent = true) {
  return {
    data: {
      viewer: { login: 'ayse' },
      repository: {
        defaultBranchRef: { name: 'develop' },
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: false,
        ...(withCurrent ? { current: { nodes: [pr(7)] } } : {}),
      },
      mine: { nodes: [pr(7), pr(8, { mergeable: 'CONFLICTING', reviewDecision: null, isDraft: true }), {}] },
      review: {
        nodes: [
          pr(9, {
            author: null,
            mergeable: 'UNKNOWN',
            reviewDecision: 'REVIEW_REQUIRED',
            isCrossRepository: true,
            files: null,
            commits: { nodes: [] },
            additions: null,
            updatedAt: 'x',
          }),
          pr(7),
        ],
      },
      rateLimit: { remaining: 4000, limit: 5000, resetAt: '2026-10-17T13:00:00Z' },
    },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

type FetchMock = ReturnType<typeof vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>>;
const asFetch = (f: FetchMock) => f as unknown as typeof fetch;
const mockFetch = (res: () => Response): FetchMock => vi.fn(async () => res());

describe('parsePrPanelResponse / fetchPrPanel', () => {
  it('mine, reviewRequested, currentBranchPr, mergeMethods ve checks', () => {
    const d = parsePrPanelResponse(panelResponse(), 123);
    expect(d).toMatchObject({ viewer: 'ayse', defaultBranch: 'develop', mergeMethods: ['merge', 'squash'], fetchedAt: 123 });
    expect(d.mine.map((p) => p.number)).toEqual([7, 8]);
    expect(d.reviewRequested.map((p) => p.number)).toEqual([9, 7]);
    // 7 hem benim hem review istenen.
    expect(d.mine[0]?.reviewRequested).toBe(true);
    expect(d.mine[1]).toMatchObject({ reviewRequested: false, mergeable: 'conflicting', reviewDecision: 'none', isDraft: true });
    expect(d.currentBranchPr).toMatchObject({ number: 7, reviewRequested: true });

    const p7 = d.mine[0];
    expect(p7).toMatchObject({
      title: 'PR 7',
      author: 'ayse',
      headRef: 'feat/7',
      baseRef: 'main',
      body: 'açıklama',
      mergeable: 'mergeable',
      reviewDecision: 'approved',
      isCrossRepository: false,
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      files: ['src/a.ts'],
      ci: 'failure',
      updatedAt: Date.parse('2026-10-15T10:00:00Z'),
    });
    expect(p7?.checks).toEqual([
      { name: 'build', state: 'success', url: 'https://github.com/o/r/actions/runs/1' },
      { name: 'test', state: 'failure', url: 'https://github.com/o/r/actions/runs/2' },
      { name: 'lint', state: 'pending' },
      { name: 'docs', state: 'none' },
      { name: 'ci/circleci', state: 'pending' },
      { name: 'codecov', state: 'failure', url: 'https://github.com/o/r/checks' },
    ]);

    const p9 = d.reviewRequested[0];
    expect(p9).toMatchObject({
      author: 'ghost',
      mergeable: 'unknown',
      reviewDecision: 'reviewRequired',
      isCrossRepository: true,
      files: [],
      checks: [],
      ci: 'none',
      additions: 0,
      updatedAt: 0,
      reviewRequested: true,
    });
  });

  it('eksik alanlar ve hatalar', () => {
    const d = parsePrPanelResponse({ data: { repository: {} } }, 1);
    expect(d).toEqual({ viewer: '', defaultBranch: 'main', mergeMethods: [], mine: [], reviewRequested: [], fetchedAt: 1 });
    expect(() => parsePrPanelResponse({ data: { repository: null } })).toThrow(expect.objectContaining({ kind: 'notFound' }));
    expect(() => parsePrPanelResponse({ errors: [{ type: 'RATE_LIMITED', message: 'x' }] })).toThrow(expect.objectContaining({ kind: 'rateLimited' }));
    expect(parsePrPanelResponse(panelResponse(false)).currentBranchPr).toBeUndefined();
  });

  it('sorgu: branch varsa current alanı ve değişkeni', () => {
    expect(prPanelQuery(true)).toContain('headRefName: $branch');
    expect(prPanelQuery(true)).toContain('$branch: String!');
    expect(prPanelQuery(false)).not.toContain('$branch');
    for (const s of ['viewer { login }', 'defaultBranchRef', 'squashMergeAllowed', '... on CheckRun', '... on StatusContext', 'reviewDecision', 'isCrossRepository']) {
      expect(prPanelQuery(true)).toContain(s);
    }
  });

  it('fetchPrPanel isteği doğru kurar', async () => {
    const f = mockFetch(() => json(panelResponse()));
    const d = await fetchPrPanel('tok', 'o', 'r', 'feat/7', asFetch(f));
    expect(d.currentBranchPr?.number).toBe(7);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/graphql');
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    expect(body.variables).toEqual({
      owner: 'o',
      name: 'r',
      branch: 'feat/7',
      mineQuery: 'repo:o/r is:pr is:open author:@me',
      reviewQuery: 'repo:o/r is:pr is:open review-requested:@me',
    });

    const f2 = mockFetch(() => json(panelResponse(false)));
    await fetchPrPanel('tok', 'o', 'r', undefined, asFetch(f2));
    const body2 = JSON.parse(String(f2.mock.calls[0]?.[1]?.body)) as { query: string; variables: Record<string, unknown> };
    expect(body2.variables.branch).toBeUndefined();
    expect(body2.query).not.toContain('$branch');

    await expect(fetchPrPanel('tok', 'o', 'r', undefined, asFetch(mockFetch(() => json({}, 401))))).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('REST', () => {
  it('createPullRequest 201 ve istek biçimi', async () => {
    const f = mockFetch(() => json({ number: 42, html_url: 'https://github.com/o/r/pull/42' }, 201));
    const input = { title: 'Başlık', body: 'Gövde', head: 'feat/x', base: 'main', draft: true };
    expect(await createPullRequest('tok', 'o', 'r', input, asFetch(f))).toEqual({ number: 42, url: 'https://github.com/o/r/pull/42' });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/repos/o/r/pulls');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer tok',
    });
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it('createPullRequest 422 (var / fark yok / diğer) ve 401', async () => {
    const input = { title: 't', body: '', head: 'h', base: 'main', draft: false };
    const exists = { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: 'A pull request already exists for o:h.' }] };
    await expect(createPullRequest('tok', 'o', 'r', input, asFetch(mockFetch(() => json(exists, 422))))).rejects.toMatchObject({
      kind: 'other',
      message: 'Bu branch için zaten açık bir PR var.',
    });
    const noCommits = { message: 'Validation Failed', errors: [{ message: 'No commits between main and h' }] };
    await expect(createPullRequest('tok', 'o', 'r', input, asFetch(mockFetch(() => json(noCommits, 422))))).rejects.toMatchObject({
      message: expect.stringContaining('base ile head arasında fark yok'),
    });
    const other = { message: 'Validation Failed', errors: [{ message: 'Draft pull requests are not supported' }] };
    await expect(createPullRequest('tok', 'o', 'r', input, asFetch(mockFetch(() => json(other, 422))))).rejects.toMatchObject({
      message: expect.stringContaining('Draft pull requests are not supported'),
    });
    const err: unknown = await createPullRequest('gizli-tok', 'o', 'r', input, asFetch(mockFetch(() => json({ message: 'Bad credentials' }, 401)))).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ kind: 'unauthorized' });
    expect(String((err as Error).message)).not.toContain('gizli-tok');
    await expect(
      createPullRequest('tok', 'o', 'r', input, asFetch(vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('mergePullRequest 200 / 405 / 409', async () => {
    const f = mockFetch(() => json({ sha: 'abc123', merged: true, message: 'Pull Request successfully merged' }));
    expect(await mergePullRequest('tok', 'o', 'r', 5, 'squash', asFetch(f))).toEqual({ sha: 'abc123' });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/repos/o/r/pulls/5/merge');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ merge_method: 'squash' });

    await expect(
      mergePullRequest('tok', 'o', 'r', 5, 'merge', asFetch(mockFetch(() => json({ message: 'Required status check "build" is failing.' }, 405)))),
    ).rejects.toMatchObject({ kind: 'other', message: expect.stringMatching(/birleştirilemedi.*Required status check "build" is failing/) });
    await expect(mergePullRequest('tok', 'o', 'r', 5, 'merge', asFetch(mockFetch(() => json({ message: 'Head branch was modified' }, 409))))).rejects.toMatchObject({
      message: "PR'ın head'i değişti, yenileyip tekrar deneyin.",
    });
  });

  it('deleteRemoteBranch 204 / 422 / 404 / 403', async () => {
    const f = mockFetch(() => json(undefined, 204));
    await expect(deleteRemoteBranch('tok', 'o', 'r', 'feat/ç x#1', asFetch(f))).resolves.toBeUndefined();
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/repos/o/r/git/refs/heads/feat/%C3%A7%20x%231');
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
    await expect(deleteRemoteBranch('tok', 'o', 'r', 'x', asFetch(mockFetch(() => json({ message: 'Reference does not exist' }, 422))))).resolves.toBeUndefined();
    await expect(deleteRemoteBranch('tok', 'o', 'r', 'x', asFetch(mockFetch(() => json({}, 404))))).resolves.toBeUndefined();
    await expect(deleteRemoteBranch('tok', 'o', 'r', 'x', asFetch(mockFetch(() => json({}, 403, { 'x-ratelimit-remaining': '10' }))))).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });
});

describe('prCheckoutCommands', () => {
  it('aynı repo: lokal yoksa --track, varsa switch + ff-only', () => {
    const p = { number: 3, headRef: 'feat/x', isCrossRepository: false };
    expect(prCheckoutCommands(p, ['main'])).toEqual([
      ['fetch', 'origin', '+refs/heads/feat/x:refs/remotes/origin/feat/x'],
      ['switch', '--track', 'origin/feat/x'],
    ]);
    expect(prCheckoutCommands(p, ['main', 'feat/x'], 'upstream')).toEqual([
      ['fetch', 'upstream', '+refs/heads/feat/x:refs/remotes/upstream/feat/x'],
      ['switch', 'feat/x'],
      ['merge', '--ff-only', 'upstream/feat/x'],
    ]);
  });

  it('fork: origin/pr/<n> ref\'ine çeker; pr/<n> yoksa oluşturur, varsa ff-only', () => {
    const p = { number: 12, headRef: 'main', isCrossRepository: true };
    expect(prCheckoutCommands(p, ['main'])).toEqual([
      ['fetch', 'origin', '+refs/pull/12/head:refs/remotes/origin/pr/12'],
      ['switch', '--no-track', '-c', 'pr/12', 'origin/pr/12'],
    ]);
    expect(prCheckoutCommands(p, ['main', 'pr/12'])).toEqual([
      ['fetch', 'origin', '+refs/pull/12/head:refs/remotes/origin/pr/12'],
      ['switch', 'pr/12'],
      ['merge', '--ff-only', 'origin/pr/12'],
    ]);
  });

  describe('gerçek repo', { timeout: 30_000 }, () => {
    let tmp = '';
    afterAll(async () => {
      if (tmp) await rm(tmp, { recursive: true, force: true });
    });

    it('fork ve aynı repo komutları gerçekten çalışır (pr/<n> checkout edilmişken de)', async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), 'gitatlas-revrev-prco-'));
      const CFG = ['-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false'];
      const origin = path.join(tmp, 'origin.git');
      const src = path.join(tmp, 'src');
      const work = path.join(tmp, 'work');
      await runGit(['init', '-q', '--bare', '-b', 'main', origin], tmp);
      await runGit(['init', '-q', '-b', 'main', src], tmp);
      const g = (dir: string, ...a: string[]) => runGit([...CFG, ...a], dir);
      await writeFile(path.join(src, 'a.txt'), 'a\n');
      await g(src, 'add', '-A');
      await g(src, 'commit', '-q', '-m', 'bir');
      await g(src, 'push', '-q', origin, 'main');
      // Aynı repo branch'i ve fork PR ref'i.
      await g(src, 'switch', '-q', '-c', 'feat/x');
      await writeFile(path.join(src, 'x.txt'), 'x\n');
      await g(src, 'add', '-A');
      await g(src, 'commit', '-q', '-m', 'x');
      await g(src, 'push', '-q', origin, 'feat/x', 'HEAD:refs/pull/5/head');

      await runGit(['clone', '-q', origin, work], tmp);
      const run = async (cmds: string[][]) => {
        for (const c of cmds) await g(work, ...c);
      };
      const head = async () => (await g(work, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();

      await run(prCheckoutCommands({ number: 5, headRef: 'feat/x', isCrossRepository: true }, ['main']));
      expect(await head()).toBe('pr/5');
      expect((await g(work, 'config', '--get-all', 'branch.pr/5.merge').catch(() => '')).trim()).toBe('');

      // PR'a yeni commit gelir; pr/5 checkout edilmişken tekrar çek.
      await writeFile(path.join(src, 'y.txt'), 'y\n');
      await g(src, 'add', '-A');
      await g(src, 'commit', '-q', '-m', 'y');
      await g(src, 'push', '-q', '-f', origin, 'HEAD:refs/pull/5/head', 'feat/x');
      await run(prCheckoutCommands({ number: 5, headRef: 'feat/x', isCrossRepository: true }, ['main', 'pr/5']));
      expect((await g(work, 'log', '-1', '--format=%s')).trim()).toBe('y');

      await run(prCheckoutCommands({ number: 6, headRef: 'feat/x', isCrossRepository: false }, ['main', 'pr/5']));
      expect(await head()).toBe('feat/x');
      expect((await g(work, 'rev-parse', '--abbrev-ref', '@{u}')).trim()).toBe('origin/feat/x');
    });
  });
});
