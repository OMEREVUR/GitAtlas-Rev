import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGit } from '../src/git/gitRunner';
import { parseNumstatLog } from '../src/git/logParser';
import { computeFileStats } from '../src/model/aggregate';
import { loadSnapshot, NoCommitsError } from '../src/model/repoService';

// runGit çağrılarını gözlemlemek için gerçek uygulamayı saran bir spy.
vi.mock('../src/git/gitRunner', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/git/gitRunner')>();
  return { ...mod, runGit: vi.fn(mod.runGit) };
});

const runGitMock = vi.mocked(runGit);

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
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
}

/** Bu testte runGit ile yapılan `git log` çağrıları (revizyon aralığı ya da tam). */
function logCalls(): { range: string | undefined; output: Promise<string> }[] {
  const calls: { range: string | undefined; output: Promise<string> }[] = [];
  runGitMock.mock.calls.forEach((call, i) => {
    const args = call[0];
    const logIdx = args.indexOf('log');
    if (logIdx === -1) return;
    const range = args.slice(logIdx + 1).find((a) => !a.startsWith('-'));
    const result = runGitMock.mock.results[i];
    if (result?.type === 'return') calls.push({ range, output: result.value });
  });
  return calls;
}

describe.skipIf(!bash)('loadSnapshot (fixture reposu)', () => {
  let repo = '';
  let storage = '';
  const temps: string[] = [];

  beforeAll(async () => {
    repo = execFileSync(bash!, [SCRIPT], { encoding: 'utf8' }).trim();
    temps.push(repo);
    storage = await mkdtemp(join(tmpdir(), 'rewiewrev-storage-'));
    temps.push(storage);
  }, 60_000);

  afterAll(async () => {
    for (const t of temps) await rm(t, { recursive: true, force: true });
  });

  beforeEach(() => {
    runGitMock.mockClear();
  });

  it('ilk çağrı tam tarama yapar', async () => {
    const progress: number[] = [];
    const snap = await loadSnapshot(repo, storage, (p) => progress.push(p));

    expect(snap.commits).toHaveLength(34);
    expect(snap.headHash).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(snap.root).toBe(repo);
    expect(Object.keys(snap.lineCounts)).toHaveLength(14);
    expect(snap.lineCounts['assets/logo.bin']).toBeUndefined();
    expect(snap.lineCounts['docs/old-notes.md']).toBeUndefined();
    expect(snap.lineCounts['src/model/repoModel.ts']).toBe(9);

    expect(logCalls().map((c) => c.range)).toEqual([undefined]);

    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);

    const now = Date.now();
    expect(snap.commits.filter((c) => c.date >= now - 7 * 86_400_000)).toHaveLength(6);
    expect(snap.commits.filter((c) => c.date >= now - 30 * 86_400_000)).toHaveLength(16);
    expect(new Set(snap.commits.map((c) => c.author)).size).toBe(3);

    const ignore = ['**/node_modules/**', '**/package-lock.json'];
    const stats = new Map(computeFileStats(snap, 'all', ignore, now).map((s) => [s.path, s]));
    expect(stats.get('src/model/repoModel.ts')?.changes).toBe(8);
    expect(stats.has('src/model/model.ts')).toBe(false);
    expect(stats.has('node_modules/leftpad/index.js')).toBe(false);
    expect(stats.has('package-lock.json')).toBe(false);
    const s30 = computeFileStats(snap, '30d', ignore, now).find((s) => s.path === 'src/model/repoModel.ts');
    const s7 = computeFileStats(snap, '7d', ignore, now).find((s) => s.path === 'src/model/repoModel.ts');
    expect(s30?.changes).toBe(3);
    expect(s7?.changes).toBe(1);
  });

  it('ikinci çağrı cache\'ten gelir (git log yok)', async () => {
    const t0 = performance.now();
    const snap = await loadSnapshot(repo, storage, () => undefined);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(snap.commits).toHaveLength(34);
    expect(logCalls()).toHaveLength(0);
  });

  it('yeni commit sonrası yalnızca 1 commit işlenir', async () => {
    const before = await loadSnapshot(repo, storage, () => undefined);
    await appendFile(join(repo, 'src', 'git', 'runner.ts'), 'export const fifth = 5;\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=Yeni Yazar', '-c', 'user.email=yeni@example.com', 'commit', '-q', '-m', 'feat: beşinci');
    runGitMock.mockClear();

    const snap = await loadSnapshot(repo, storage, () => undefined);

    const calls = logCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.range).toBe(`${before.headHash}..HEAD`);
    expect(parseNumstatLog(await calls[0]!.output)).toHaveLength(1);

    expect(snap.commits).toHaveLength(35);
    expect(snap.commits[0]!.message).toBe('feat: beşinci');
    expect(snap.commits.slice(1)).toEqual(before.commits);
    expect(snap.lineCounts['src/git/runner.ts']).toBe(before.lineCounts['src/git/runner.ts']! + 1);
    expect(snap.lineCounts['assets/logo.bin']).toBeUndefined();
  });

  it('reset --hard HEAD~2 sonrası baştan taranır', async () => {
    git(repo, 'reset', '-q', '--hard', 'HEAD~2');
    const snap = await loadSnapshot(repo, storage, () => undefined);

    expect(logCalls().map((c) => c.range)).toEqual([undefined]);
    expect(snap.commits).toHaveLength(33);
    expect(snap.headHash).toBe(git(repo, 'rev-parse', 'HEAD'));
  });

  it('commit\'i olmayan repo → NoCommitsError', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'rewiewrev-empty-'));
    temps.push(empty);
    git(empty, 'init', '-q');
    await expect(loadSnapshot(empty, storage, () => undefined)).rejects.toBeInstanceOf(NoCommitsError);
  });

  it('repo olmayan klasör → GitError notRepo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'rewiewrev-plain-'));
    temps.push(plain);
    await expect(loadSnapshot(plain, storage, () => undefined)).rejects.toMatchObject({
      name: 'GitError',
      code: 'notRepo',
    });
  });
});
