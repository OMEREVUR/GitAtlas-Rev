import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  type Listener = (e: unknown) => void;
  class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];
    event = (l: (e: T) => void) => {
      this.listeners.push(l);
      return { dispose: () => undefined };
    };
    fire(e: T): void {
      for (const l of this.listeners) l(e);
    }
    dispose(): void {
      this.listeners = [];
    }
  }
  const state = {
    config: {} as Record<string, unknown>,
    session: undefined as { accessToken: string } | undefined,
    interactiveSession: undefined as { accessToken: string } | undefined,
    getSessionCalls: 0,
    sessionListeners: [] as Listener[],
  };
  const vscode = {
    EventEmitter,
    authentication: {
      getSession: async (_id: string, _scopes: string[], opts: { createIfNone?: boolean }) => {
        state.getSessionCalls++;
        if (opts.createIfNone) {
          if (!state.interactiveSession) throw new Error('İptal');
          state.session = state.interactiveSession;
        }
        return state.session;
      },
      onDidChangeSessions: (l: Listener) => {
        state.sessionListeners.push(l);
        return { dispose: () => undefined };
      },
    },
    workspace: {
      getConfiguration: () => ({ get: (key: string, def: unknown) => (key in state.config ? state.config[key] : def) }),
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
  };
  return { state, vscode };
});

vi.mock('vscode', () => mock.vscode);

import { runGit } from '../src/git/gitRunner';
import { effectiveIntervalMin, GitHubLayer } from '../src/github/githubLayer';
import { fetchPulls, GitHubApiError, parsePullsResponse, PULLS_QUERY } from '../src/github/graphql';
import { GitHubProvider } from '../src/github/provider';
import { getOriginUrl, parseGitHubRemote, redactRemoteUrl } from '../src/github/remote';

function sampleResponse(remaining = 4990) {
  return {
    data: {
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 12,
              title: 'Rozetler: ısı',
              url: 'https://github.com/o/r/pull/12',
              isDraft: false,
              updatedAt: '2026-10-10T12:00:00Z',
              author: { login: 'mert' },
              headRefName: 'feat/badges',
              baseRefName: 'main',
              files: { nodes: [{ path: 'src/a.ts' }, { path: 'src/çalışma.ts' }] },
              commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
            },
            {
              number: 13,
              title: 'Taslak',
              url: 'https://github.com/o/r/pull/13',
              isDraft: true,
              updatedAt: 'bozuk-tarih',
              author: null,
              headRefName: 'wip',
              baseRefName: 'main',
              files: null,
              commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
            },
            { title: 'numarasız → atlanır' },
          ],
        },
        refs: {
          nodes: [
            { name: 'main', target: { statusCheckRollup: { state: 'SUCCESS' } } },
            { name: 'feat/badges', target: { statusCheckRollup: { state: 'ERROR' } } },
            { name: 'wip', target: { statusCheckRollup: { state: 'PENDING' } } },
            { name: 'beklenen', target: { statusCheckRollup: { state: 'EXPECTED' } } },
            { name: 'eski', target: {} },
          ],
        },
      },
      rateLimit: { remaining, limit: 5000, resetAt: '2026-10-17T13:00:00Z' },
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('parseGitHubRemote', () => {
  it.each([
    ['https://github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/r', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/r/', { owner: 'o', repo: 'r' }],
    ['https://user:tok@github.com/Owner/Repo.git', { owner: 'Owner', repo: 'Repo' }],
    ['http://www.github.com/o/r.js.git', { owner: 'o', repo: 'r.js' }],
    ['git@github.com:o/r.git', { owner: 'o', repo: 'r' }],
    ['git@github.com:o/r', { owner: 'o', repo: 'r' }],
    ['ssh://git@github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['ssh://git@github.com:22/o/r.git', { owner: 'o', repo: 'r' }],
    ['git://github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['  https://GitHub.com/o/r.git\n', { owner: 'o', repo: 'r' }],
  ])('%s', (url, expected) => {
    expect(parseGitHubRemote(url)).toEqual(expected);
  });

  it.each([
    'https://gitlab.com/o/r.git',
    'git@gitlab.com:o/r.git',
    'https://github.example.com/o/r.git',
    'https://github.com/o',
    'https://github.com/o/r/extra',
    'C:/repos/r',
    '../r.git',
    '',
  ])('GitHub değil: %s', (url) => {
    expect(parseGitHubRemote(url)).toBeUndefined();
  });

  it('redactRemoteUrl kimlik bilgisini atar', () => {
    expect(redactRemoteUrl('https://user:ghp_secret@gitlab.com/o/r.git')).toBe('https://gitlab.com/o/r.git');
    expect(redactRemoteUrl('git@gitlab.com:o/r.git')).toBe('git@gitlab.com:o/r.git');
  });
});

describe('parsePullsResponse', () => {
  it('PR, dosya, rollup ve eksik alanlar', () => {
    const r = parsePullsResponse(sampleResponse());
    expect(r.pullRequests).toEqual([
      {
        number: 12,
        title: 'Rozetler: ısı',
        url: 'https://github.com/o/r/pull/12',
        author: 'mert',
        headRef: 'feat/badges',
        baseRef: 'main',
        isDraft: false,
        updatedAt: Date.parse('2026-10-10T12:00:00Z'),
        files: ['src/a.ts', 'src/çalışma.ts'],
        ci: 'failure',
      },
      {
        number: 13,
        title: 'Taslak',
        url: 'https://github.com/o/r/pull/13',
        author: 'ghost',
        headRef: 'wip',
        baseRef: 'main',
        isDraft: true,
        updatedAt: 0,
        files: [],
        ci: 'none',
      },
    ]);
    expect(r.branchCi).toEqual([
      { branch: 'main', ci: 'success' },
      { branch: 'feat/badges', ci: 'failure' },
      { branch: 'wip', ci: 'pending' },
      { branch: 'beklenen', ci: 'pending' },
      { branch: 'eski', ci: 'none' },
    ]);
    expect(r.rateLimit).toEqual({ remaining: 4990, limit: 5000, resetAt: Date.parse('2026-10-17T13:00:00Z') });
  });

  it('bozuk girdiye dayanıklı', () => {
    expect(parsePullsResponse({ data: { repository: {} } })).toEqual({ pullRequests: [], branchCi: [] });
    expect(() => parsePullsResponse(null)).toThrow(GitHubApiError);
    expect(() => parsePullsResponse({ data: { repository: null } })).toThrow(expect.objectContaining({ kind: 'notFound' }));
  });

  it('GraphQL errors → GitHubApiError', () => {
    expect(() => parsePullsResponse({ errors: [{ type: 'NOT_FOUND', message: 'yok' }] })).toThrow(expect.objectContaining({ kind: 'notFound' }));
    expect(() => parsePullsResponse({ errors: [{ type: 'RATE_LIMITED', message: 'x' }] })).toThrow(expect.objectContaining({ kind: 'rateLimited' }));
    expect(() => parsePullsResponse({ errors: [{ message: 'Something' }] })).toThrow(expect.objectContaining({ kind: 'other' }));
  });

  it('sorgu istenen alanları içerir', () => {
    for (const s of ['states: OPEN', 'first: 50', 'files(first: 100)', 'commits(last: 1)', 'statusCheckRollup', 'refPrefix: "refs/heads/"', 'rateLimit']) {
      expect(PULLS_QUERY).toContain(s);
    }
  });
});

describe('fetchPulls', () => {
  it('200: isteği doğru kurar ve ayrıştırır', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(sampleResponse()));
    const r = await fetchPulls('tok123', 'o', 'r', fetchFn as unknown as typeof fetch);
    expect(r.pullRequests).toHaveLength(2);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('bearer tok123');
    const body: unknown = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ variables: { owner: 'o', name: 'r' } });
  });

  it('401 → unauthorized', async () => {
    const f = async () => jsonResponse({ message: 'Bad credentials' }, 401);
    await expect(fetchPulls('t', 'o', 'r', f as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('403 + limit 0 → rateLimited (resetAt header\'dan)', async () => {
    const f = async () => jsonResponse({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1800000000' });
    await expect(fetchPulls('t', 'o', 'r', f as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'rateLimited',
      rateLimit: { remaining: 0, limit: 5000, resetAt: 1_800_000_000_000 },
    });
  });

  it('403 (limit var) → unauthorized, 429 → rateLimited, 500 → other', async () => {
    const f403 = async () => jsonResponse({}, 403, { 'x-ratelimit-remaining': '100' });
    await expect(fetchPulls('t', 'o', 'r', f403 as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'unauthorized' });
    const f429 = async () => jsonResponse({}, 429);
    await expect(fetchPulls('t', 'o', 'r', f429 as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'rateLimited' });
    const f500 = async () => jsonResponse({}, 500);
    await expect(fetchPulls('t', 'o', 'r', f500 as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'other' });
  });

  it('ağ hatası → network', async () => {
    const f = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(fetchPulls('t', 'o', 'r', f as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('GitHubProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sonucu ≈10 sn paylaşır, force ve süre dolunca yeniden çeker', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchFn = vi.fn(async () => jsonResponse(sampleResponse()));
    const p = new GitHubProvider('o', 'r', async () => 'tok', fetchFn as unknown as typeof fetch);
    const [a, b] = await Promise.all([p.getOpenPullRequests(), p.getBranchStatus('main')]);
    expect(a).toHaveLength(2);
    expect(b).toBe('success');
    expect(await p.getBranchStatus('feat/badges')).toBe('failure');
    expect(await p.getBranchStatus('olmayan')).toBe('none');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 11_000;
    await p.fetchAll();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await p.fetchAll(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('PR head branch\'i refs listesinde yoksa PR\'ın CI\'ı', async () => {
    const res = sampleResponse();
    res.data.repository.refs.nodes = [];
    const p = new GitHubProvider('o', 'r', async () => 'tok', (async () => jsonResponse(res)) as unknown as typeof fetch);
    expect(await p.getBranchStatus('feat/badges')).toBe('failure');
  });

  it('hata paylaşılmaz; token yoksa unauthorized', async () => {
    let fail = true;
    const fetchFn = vi.fn(async () => {
      if (fail) throw new TypeError('ağ');
      return jsonResponse(sampleResponse());
    });
    const p = new GitHubProvider('o', 'r', async () => 'tok', fetchFn as unknown as typeof fetch);
    await expect(p.fetchAll()).rejects.toMatchObject({ kind: 'network' });
    fail = false;
    await expect(p.fetchAll()).resolves.toMatchObject({ pullRequests: expect.any(Array) });

    const noToken = new GitHubProvider('o', 'r', async () => undefined, fetchFn as unknown as typeof fetch);
    expect(await noToken.isAvailable()).toBe(false);
    await expect(noToken.fetchAll()).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('effectiveIntervalMin', () => {
  const reset = Date.now() + 3_600_000;
  it('limit bolken ayar, azalınca 5 katı (en çok 30), sıfırlanınca ayar', () => {
    expect(effectiveIntervalMin(2, undefined)).toBe(2);
    expect(effectiveIntervalMin(2, { remaining: 600, limit: 5000, resetAt: reset })).toBe(2);
    expect(effectiveIntervalMin(2, { remaining: 400, limit: 5000, resetAt: reset })).toBe(10);
    expect(effectiveIntervalMin(10, { remaining: 0, limit: 5000, resetAt: reset })).toBe(30);
    expect(effectiveIntervalMin(45, { remaining: 0, limit: 5000, resetAt: reset })).toBe(45);
    expect(effectiveIntervalMin(2, { remaining: 0, limit: 5000, resetAt: Date.now() - 1 })).toBe(2);
  });
});

describe('getOriginUrl + GitHubLayer (vscode taklidi)', () => {
  let tmp = '';
  let repo = '';
  let storage = '';
  const memento = () => {
    const m = new Map<string, unknown>();
    return {
      keys: () => [...m.keys()],
      get: <T>(k: string, d?: T) => (m.has(k) ? (m.get(k) as T) : d),
      update: async (k: string, v: unknown) => {
        m.set(k, v);
      },
      store: m,
    };
  };
  const layers: GitHubLayer[] = [];
  const newLayer = (ws = memento()) => {
    const l = new GitHubLayer(storage, ws);
    layers.push(l);
    return l;
  };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'gitatlas-revrev-gh-'));
    repo = path.join(tmp, 'repo');
    await runGit(['init', '-q', '-b', 'main', repo], tmp);
  });

  beforeEach(async () => {
    storage = await mkdtemp(path.join(tmp, 'storage-'));
    mock.state.config = {};
    mock.state.session = undefined;
    mock.state.interactiveSession = undefined;
    mock.state.getSessionCalls = 0;
    await runGit(['remote', 'remove', 'origin'], repo).catch(() => undefined);
  });

  afterEach(() => {
    for (const l of layers.splice(0)) l.dispose();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('getOriginUrl: remote yoksa undefined, varsa adres', async () => {
    expect(await getOriginUrl(repo)).toBeUndefined();
    await runGit(['remote', 'add', 'origin', 'git@github.com:o/r.git'], repo);
    expect(await getOriginUrl(repo)).toBe('git@github.com:o/r.git');
  });

  it('ayar kapalı → off, hiç istek yok', async () => {
    mock.state.config['github.enabled'] = false;
    await runGit(['remote', 'add', 'origin', 'git@github.com:o/r.git'], repo);
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const l = newLayer();
    await l.setRoot(repo);
    expect(l.data.status).toEqual({ state: 'off', dismissed: false });
    expect(mock.state.getSessionCalls).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('noRemote ve notGitHub (adres kimliksiz)', async () => {
    const l = newLayer();
    await l.setRoot(repo);
    expect(l.data.status).toEqual({ state: 'noRemote' });
    await runGit(['remote', 'add', 'origin', 'https://user:secret@gitlab.com/o/r.git'], repo);
    await l.setRoot(repo);
    expect(l.data.status).toEqual({ state: 'notGitHub', remoteUrl: 'https://gitlab.com/o/r.git' });
  });

  it('oturum yok → off; connect → connected + cache; sonra oturumsuz açılış → stale', async () => {
    await runGit(['remote', 'add', 'origin', 'https://github.com/o/r.git'], repo);
    const fetchFn = vi.fn(async () => jsonResponse(sampleResponse()));
    vi.stubGlobal('fetch', fetchFn);

    const l = newLayer();
    const events: string[] = [];
    l.onDidChange((d) => events.push(d.status.state));
    await l.setRoot(repo);
    expect(l.data.status).toEqual({ state: 'off', dismissed: false });
    expect(fetchFn).not.toHaveBeenCalled();

    mock.state.interactiveSession = { accessToken: 'gizli-token' };
    await l.connect();
    expect(l.data.status).toMatchObject({ state: 'connected', repo: 'o/r', intervalMin: 2, baseIntervalMin: 2 });
    expect(l.data.pullRequests).toHaveLength(2);
    expect(l.data.branchCi).toHaveLength(5);
    expect(events).toContain('connecting');

    await vi.waitFor(async () => expect((await readdir(storage)).some((f) => /^github-[0-9a-f]{16}\.json$/.test(f))).toBe(true));
    const file = (await readdir(storage)).find((f) => f.startsWith('github-')) ?? '';
    const cacheText = await readFile(path.join(storage, file), 'utf8');
    expect(cacheText).not.toContain('gizli-token');
    expect(JSON.parse(cacheText)).toMatchObject({ version: 1, fetchedAt: expect.any(Number) });

    // Yeni açılış, oturum yok: cache'ten stale.
    mock.state.session = undefined;
    const l2 = newLayer();
    await l2.setRoot(repo);
    expect(l2.data.status).toMatchObject({ state: 'stale', repo: 'o/r', reason: 'sessionExpired' });
    expect(l2.data.pullRequests).toHaveLength(2);
  });

  it('ağ hatası → stale offline; 401 → stale sessionExpired; limit azalınca aralık uzar', async () => {
    await runGit(['remote', 'add', 'origin', 'https://github.com/o/r.git'], repo);
    mock.state.session = { accessToken: 't' };
    let mode: 'ok' | 'low' | 'net' | '401' = 'ok';
    vi.stubGlobal('fetch', async () => {
      if (mode === 'net') throw new TypeError('fetch failed');
      if (mode === '401') return jsonResponse({}, 401);
      const res = sampleResponse(mode === 'low' ? 100 : 4990);
      res.data.rateLimit.resetAt = new Date(Date.now() + 3_600_000).toISOString();
      return jsonResponse(res);
    });
    const l = newLayer();
    await l.setRoot(repo);
    expect(l.data.status).toMatchObject({ state: 'connected', intervalMin: 2 });

    mode = 'low';
    await l.refresh();
    expect(l.data.status).toMatchObject({ state: 'connected', intervalMin: 10, baseIntervalMin: 2, rateLimit: { remaining: 100 } });

    mode = 'net';
    await l.refresh();
    expect(l.data.status).toMatchObject({ state: 'stale', reason: 'offline' });
    expect(l.data.pullRequests).toHaveLength(2);

    mode = '401';
    await l.refresh();
    expect(l.data.status).toMatchObject({ state: 'stale', reason: 'sessionExpired' });
  });

  it('dismiss → off dismissed, workspaceState\'e yazılır ve sonraki açılışta korunur', async () => {
    await runGit(['remote', 'add', 'origin', 'https://github.com/o/r.git'], repo);
    const ws = memento();
    const l = newLayer(ws);
    await l.setRoot(repo);
    l.dismiss();
    expect(l.data.status).toEqual({ state: 'off', dismissed: true });
    expect(ws.store.get('gitatlas-revrev.github.dismissed')).toBe(true);
    const l2 = newLayer(ws);
    await l2.setRoot(repo);
    expect(l2.data.status).toEqual({ state: 'off', dismissed: true });
  });

  it('connect iptal → off', async () => {
    await runGit(['remote', 'add', 'origin', 'https://github.com/o/r.git'], repo);
    const l = newLayer();
    await l.setRoot(repo);
    await l.connect();
    expect(l.data.status).toEqual({ state: 'off', dismissed: false });
  });
});
