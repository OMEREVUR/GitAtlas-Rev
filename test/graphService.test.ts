import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { branchCommits } from '../src/model/graphSelect';
import { loadGraph } from '../src/model/graphService';

function findBash(): string | undefined {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    try {
      // .../Git/mingw64/libexec/git-core → .../Git/bin/bash.exe (WSL bash'ini değil, Git Bash'i seç)
      const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
      candidates.push(resolve(exec, '..', '..', '..', 'bin', 'bash.exe'));
    } catch {
      return undefined;
    }
  }
  candidates.push('bash');
  for (const c of candidates) {
    if (c !== 'bash' && !existsSync(c)) continue;
    try {
      execFileSync(c, ['-c', 'git --version'], { stdio: 'ignore' });
      return c;
    } catch {
      // sıradaki aday
    }
  }
  return undefined;
}

const bash = findBash();
const SCRIPT = resolve(__dirname, '..', 'scripts', 'make-fixture.sh');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe.skipIf(!bash)('loadGraph (fixture reposu)', () => {
  let repo = '';
  const temps: string[] = [];

  beforeAll(() => {
    repo = execFileSync(bash!, [SCRIPT], { encoding: 'utf8' }).trim();
    temps.push(repo);
  }, 60_000);

  afterAll(async () => {
    for (const t of temps) await rm(t, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('tüm branch\'ler', async () => {
    const g = await loadGraph(repo, { limit: 500 });
    expect(g.commits).toHaveLength(43);
    expect(g.hasMore).toBe(false);
    expect(g.limit).toBe(500);
    expect(g.branch).toBeUndefined();
    expect(g.head).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(g.currentBranch).toBe('main');
    expect(g.layout.rows.map((r) => r.hash)).toEqual(g.commits.map((c) => c.hash));
    expect(g.layout.rows.filter((r) => r.isMerge)).toHaveLength(1);
    // --topo-order her branch'i ayrıldığı noktanın hemen üstüne dizer; şeritler yeniden kullanılır.
    expect(g.layout.laneCount).toBe(2);
    const rowOf = (msg: string) => g.layout.rows[g.commits.findIndex((c) => c.message === msg)]!;
    expect(rowOf('test: üçüncü').lane).toBe(0);
    for (const msg of ['feat: graph kenarları', 'fix: parser rename', 'spike: canvas ikinci deneme', 'docs: canvas sonucu']) {
      expect(rowOf(msg).lane, msg).toBe(1);
      // Yan şeridin rengi, o an etkin olan main şeridinin renginden farklı.
      expect(rowOf(msg).color, msg).not.toBe(rowOf('test: üçüncü').color);
    }
    // Tüm parent'lar yüklü → hiçbir kenar alt kenara uzamaz.
    for (const e of g.layout.edges) expect(e.points[e.points.length - 1]!.row).toBeLessThan(43);

    const byName = new Map(g.refs.map((r) => [r.name, r]));
    expect([...byName.keys()].sort()).toEqual(
      ['feature/graph', 'fix/parser', 'main', 'origin/experiment/canvas', 'origin/main', 'spike/canvas', 'v0.1.0'].sort(),
    );
    expect(byName.get('main')).toMatchObject({ isHead: true, upstream: 'origin/main', ahead: 2, behind: 0 });
    expect(byName.get('feature/graph')).toMatchObject({ ahead: 3, behind: 5 });
    expect(byName.get('fix/parser')).toMatchObject({ ahead: 2, behind: 17 });
    expect(byName.get('spike/canvas')).toMatchObject({ ahead: 2, behind: 25 });
    expect(byName.get('origin/experiment/canvas')).toMatchObject({ kind: 'remote', ahead: 2, behind: 22 });
    expect(byName.get('v0.1.0')?.kind).toBe('tag');

    const own = (name: string): string[] =>
      branchCommits(byName.get(name)!, g.refs, g.commits, g.head).map((c) => c.message);
    expect(own('feature/graph')).toEqual(['feat: graph kenarları', 'feat: graph şeritleri', 'feat: graph iskeleti']);
    expect(own('main')).toEqual(['test: üçüncü', 'chore: extension']);
    expect(own('spike/canvas')).toHaveLength(2);
  });

  it('tek branch', async () => {
    const g = await loadGraph(repo, { limit: 500, branch: 'feature/graph' });
    expect(g.branch).toBe('feature/graph');
    // main'in 6g önceki commit'ine kadar 29 commit (merge'ün 2 feature commit'i dahil) + 3 kendi commit'i
    expect(g.commits).toHaveLength(32);
    expect(g.commits[0]!.message).toBe('feat: graph kenarları');
    expect(g.refs.length).toBe(7);
    expect(g.currentBranch).toBe('main');
  });

  it('limit ve hasMore', async () => {
    const g = await loadGraph(repo, { limit: 10 });
    expect(g.commits).toHaveLength(10);
    expect(g.hasMore).toBe(true);
    expect(g.layout.rows).toHaveLength(10);
    // Yüklenmemiş parent'lara giden kenarlar alt kenara (row = 10) uzar.
    expect(g.layout.edges.some((e) => e.points[e.points.length - 1]!.row === 10)).toBe(true);

    const exact = await loadGraph(repo, { limit: 43 });
    expect(exact.commits).toHaveLength(43);
    expect(exact.hasMore).toBe(false);
  });

  it('commit\'siz repo: boş graph, hata yok', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'gitatlas-revrev-graph-empty-'));
    temps.push(empty);
    git(empty, 'init', '-q', '-b', 'main');
    const g = await loadGraph(empty, { limit: 500 });
    expect(g.commits).toEqual([]);
    expect(g.refs).toEqual([]);
    expect(g.head).toBeUndefined();
    expect(g.currentBranch).toBeUndefined();
    expect(g.hasMore).toBe(false);
    expect(g.layout).toEqual({ rows: [], edges: [], laneCount: 0 });
  });

  it('repo olmayan klasör → GitError notRepo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'gitatlas-revrev-graph-plain-'));
    temps.push(plain);
    await expect(loadGraph(plain, { limit: 10 })).rejects.toMatchObject({ name: 'GitError', code: 'notRepo' });
  });
});
