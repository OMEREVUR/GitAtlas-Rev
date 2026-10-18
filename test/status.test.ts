import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAskpassEnv } from '../src/git/askpass';
import { classifyGitError, GitError, runGit, setGitPath } from '../src/git/gitRunner';
import { opCommands } from '../src/git/opCommands';
import { getStatus, listStashes, parseNumstatZ, parsePorcelainV2 } from '../src/git/status';
import type { WorkingFile, WorkingTreeStatus } from '../src/types';

const CFG = ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];

let tmp = '';
let counter = 0;

async function makeRepo(name: string): Promise<{ dir: string; git: (...a: string[]) => Promise<string> }> {
  const dir = path.join(tmp, `${name}-${counter++}`);
  await runGit(['init', '-q', '-b', 'main', dir], tmp);
  return { dir, git: (...a: string[]) => runGit([...CFG, ...a], dir) };
}

function file(s: WorkingTreeStatus, p: string): WorkingFile {
  const f = s.files.find((x) => x.path === p);
  if (!f) throw new Error(`dosya yok: ${p}`);
  return f;
}

async function runOp(dir: string, cmds: string[][]): Promise<void> {
  for (const c of cmds) await runGit([...CFG, ...c], dir);
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'gitatlas-revrev-status-'));
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('parsePorcelainV2 / parseNumstatZ (sabit)', () => {
  it('başlıklar ve kayıt türleri', () => {
    const raw = [
      '# branch.oid ' + 'a'.repeat(40),
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '# stash 3',
      '1 MM N... 100644 100644 100644 ' + 'b'.repeat(40) + ' ' + 'c'.repeat(40) + ' src/boşluklu ad.ts',
      '2 R. N... 100644 100644 100644 ' + 'b'.repeat(40) + ' ' + 'b'.repeat(40) + ' R100 yeni.ts',
      'eski.ts',
      'u UU N... 100644 100644 100644 100644 ' + ['1', '2', '3'].map((c) => c.repeat(40)).join(' ') + ' çakışma.txt',
      '? yeni/ç.txt',
      '',
    ].join('\0');
    const s = parsePorcelainV2(raw);
    expect(s).toMatchObject({ branch: 'main', head: 'a'.repeat(40), upstream: 'origin/main', ahead: 2, behind: 1, stashCount: 3 });
    expect(s.files).toEqual([
      { path: 'src/boşluklu ad.ts', staged: 'modified', unstaged: 'modified', conflicted: false },
      { path: 'yeni.ts', oldPath: 'eski.ts', staged: 'renamed', conflicted: false },
      { path: 'çakışma.txt', unstaged: 'modified', conflicted: true },
      { path: 'yeni/ç.txt', unstaged: 'untracked', conflicted: false },
    ]);
    expect(parsePorcelainV2('# branch.oid (initial)\0# branch.head (detached)\0')).toEqual({ ahead: 0, behind: 0, stashCount: 0, files: [] });
  });

  it('numstat -z: rename ve binary', () => {
    const m = parseNumstatZ(['3\t1\ta.ts', '-\t-\tb.bin', '2\t0\t', 'eski.ts', 'yeni.ts', ''].join('\0'));
    expect([...m]).toEqual([
      ['a.ts', { added: 3, deleted: 1 }],
      ['yeni.ts', { added: 2, deleted: 0 }],
    ]);
  });
});

describe('getStatus (gerçek repo)', { timeout: 30_000 }, () => {
  it('staged/unstaged/untracked/silinmiş/rename/binary/ikisi birden', async () => {
    const { dir, git } = await makeRepo('mixed');
    await writeFile(path.join(dir, 'a.txt'), '1\n2\n3\n');
    await writeFile(path.join(dir, 'b.txt'), 'b\n');
    await writeFile(path.join(dir, 'old.txt'), 'taşınacak içerik\nikinci satır\n');
    await writeFile(path.join(dir, 'img.bin'), Buffer.from([0, 1, 2, 3]));
    await git('add', '-A');
    await git('commit', '-q', '-m', 'ilk');

    await writeFile(path.join(dir, 'a.txt'), '1\n2\n3\n4\n');
    await git('add', 'a.txt');
    await writeFile(path.join(dir, 'a.txt'), '0\n1\n2\n3\n4\n');
    await unlink(path.join(dir, 'b.txt'));
    await git('mv', 'old.txt', 'new.txt');
    await writeFile(path.join(dir, 'img.bin'), Buffer.from([0, 9, 9, 9, 9]));
    await git('add', 'img.bin');
    await writeFile(path.join(dir, 'n.txt'), 'yeni\n');
    await git('add', 'n.txt');
    await writeFile(path.join(dir, 'u.txt'), 'x\ny');
    await writeFile(path.join(dir, 'ub.bin'), Buffer.from([0, 0, 1]));
    await mkdir(path.join(dir, 'klasör'));
    await writeFile(path.join(dir, 'klasör', 'ç a.txt'), 'tek\n');

    const s = await getStatus(dir);
    expect(s).toMatchObject({ branch: 'main', ahead: 0, behind: 0, stashCount: 0 });
    expect(s.upstream).toBeUndefined();
    expect(s.operation).toBeUndefined();
    expect(s.head).toMatch(/^[0-9a-f]{40}$/);
    expect(s.lastCommit).toMatchObject({ hash: s.head, message: 'ilk', pushed: false });

    expect(file(s, 'a.txt')).toEqual({
      path: 'a.txt',
      staged: 'modified',
      unstaged: 'modified',
      conflicted: false,
      stagedStat: { added: 1, deleted: 0 },
      unstagedStat: { added: 1, deleted: 0 },
    });
    expect(file(s, 'b.txt')).toEqual({ path: 'b.txt', unstaged: 'deleted', conflicted: false, unstagedStat: { added: 0, deleted: 1 } });
    expect(file(s, 'new.txt')).toEqual({
      path: 'new.txt',
      oldPath: 'old.txt',
      staged: 'renamed',
      conflicted: false,
      stagedStat: { added: 0, deleted: 0 },
    });
    expect(file(s, 'img.bin')).toEqual({ path: 'img.bin', staged: 'modified', conflicted: false });
    expect(file(s, 'n.txt')).toMatchObject({ staged: 'added', stagedStat: { added: 1, deleted: 0 } });
    expect(file(s, 'u.txt')).toEqual({ path: 'u.txt', unstaged: 'untracked', conflicted: false, unstagedStat: { added: 2, deleted: 0 } });
    expect(file(s, 'ub.bin')).toEqual({ path: 'ub.bin', unstaged: 'untracked', conflicted: false });
    expect(file(s, 'klasör/ç a.txt')).toMatchObject({ unstaged: 'untracked', unstagedStat: { added: 1, deleted: 0 } });
    expect(s.files).toHaveLength(8);

    // discard/unstage komutları gerçekten çalışır.
    await runOp(dir, opCommands({ kind: 'discard', paths: ['a.txt', 'u.txt'] }, s));
    await runOp(dir, opCommands({ kind: 'unstage', paths: ['n.txt'] }, s));
    const s2 = await getStatus(dir);
    expect(file(s2, 'a.txt')).toMatchObject({ staged: 'modified' });
    expect(file(s2, 'a.txt').unstaged).toBeUndefined();
    expect(s2.files.some((f) => f.path === 'u.txt')).toBe(false);
    expect(file(s2, 'n.txt')).toMatchObject({ unstaged: 'untracked' });
  });

  it('merge çakışması: u kaydı, operation merge, abort ve continue', async () => {
    const { dir, git } = await makeRepo('merge');
    await writeFile(path.join(dir, 'f.txt'), 'ortak\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'taban');
    await git('switch', '-q', '-c', 'yan');
    await writeFile(path.join(dir, 'f.txt'), 'yan\n');
    await git('commit', '-q', '-am', 'yan');
    await git('switch', '-q', 'main');
    await writeFile(path.join(dir, 'f.txt'), 'ana\n');
    await git('commit', '-q', '-am', 'ana');

    const err: unknown = await git(...opCommands({ kind: 'mergeBranch', branch: 'yan' })[0]!).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).kind).toBe('conflict');
    expect((err as GitError).stdout).toContain('CONFLICT');

    const s = await getStatus(dir);
    expect(s.operation).toBe('merge');
    expect(file(s, 'f.txt')).toMatchObject({ conflicted: true });

    await runOp(dir, opCommands({ kind: 'abortOperation' }, s));
    const s2 = await getStatus(dir);
    expect(s2.operation).toBeUndefined();
    expect(s2.files).toEqual([]);

    // Tekrar çakıştır, çöz ve devam et (editör açılmamalı).
    await git('merge', '--no-edit', 'yan').catch(() => undefined);
    await writeFile(path.join(dir, 'f.txt'), 'çözüldü\n');
    const s3 = await getStatus(dir);
    await runOp(dir, opCommands({ kind: 'markResolved', paths: ['f.txt'] }, s3));
    await runOp(dir, opCommands({ kind: 'continueOperation' }, await getStatus(dir)));
    const s4 = await getStatus(dir);
    expect(s4.operation).toBeUndefined();
    expect((await git('rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(3);
  });

  it('rebase durumu ve editörsüz continue', async () => {
    const { dir, git } = await makeRepo('rebase');
    await writeFile(path.join(dir, 'f.txt'), 'ortak\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'taban');
    await git('switch', '-q', '-c', 'yan');
    await writeFile(path.join(dir, 'f.txt'), 'yan\n');
    await git('commit', '-q', '-am', 'yan');
    await git('switch', '-q', 'main');
    await writeFile(path.join(dir, 'f.txt'), 'ana\n');
    await git('commit', '-q', '-am', 'ana');
    await git('switch', '-q', 'yan');
    await git('rebase', 'main').catch(() => undefined);

    const s = await getStatus(dir);
    expect(s.operation).toBe('rebase');
    expect(s.branch).toBeUndefined();
    expect(file(s, 'f.txt').conflicted).toBe(true);

    await writeFile(path.join(dir, 'f.txt'), 'birleşik\n');
    await runOp(dir, opCommands({ kind: 'markResolved', paths: ['f.txt'] }, s));
    await runOp(dir, opCommands({ kind: 'continueOperation' }, s));
    const s2 = await getStatus(dir);
    expect(s2.operation).toBeUndefined();
    expect(s2.branch).toBe('yan');
  });

  it('detached HEAD ve boş repo', async () => {
    const { dir, git } = await makeRepo('detached');
    await writeFile(path.join(dir, 'f.txt'), 'x\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'bir');
    await git('checkout', '-q', '--detach');
    const s = await getStatus(dir);
    expect(s.branch).toBeUndefined();
    expect(s.head).toMatch(/^[0-9a-f]{40}$/);
    expect(s.lastCommit?.message).toBe('bir');

    const e = await makeRepo('empty');
    const se = await getStatus(e.dir);
    expect(se).toEqual({ branch: 'main', ahead: 0, behind: 0, files: [], stashCount: 0 });
    await writeFile(path.join(e.dir, 'ilk.txt'), 'a\nb\n');
    await e.git('add', '-A');
    const se2 = await getStatus(e.dir);
    expect(se2.head).toBeUndefined();
    expect(se2.lastCommit).toBeUndefined();
    expect(file(se2, 'ilk.txt')).toEqual({ path: 'ilk.txt', staged: 'added', conflicted: false, stagedStat: { added: 2, deleted: 0 } });
    await runOp(e.dir, opCommands({ kind: 'unstage', paths: ['ilk.txt'] }, se2));
    expect(file(await getStatus(e.dir), 'ilk.txt').unstaged).toBe('untracked');
    expect(await listStashes(e.dir)).toEqual([]);
  });

  it('upstream, ahead/behind ve lastCommit.pushed', async () => {
    const origin = path.join(tmp, `origin-${counter++}.git`);
    await runGit(['init', '-q', '--bare', '-b', 'main', origin], tmp);
    const { dir, git } = await makeRepo('up');
    await git('remote', 'add', 'origin', origin);
    await writeFile(path.join(dir, 'f.txt'), '1\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'bir');

    // Upstream yokken push komutu -u origin main.
    const s0 = await getStatus(dir);
    expect(opCommands({ kind: 'push' }, s0)).toEqual([['push', '-u', 'origin', 'main']]);
    await runOp(dir, opCommands({ kind: 'push' }, s0));

    const s1 = await getStatus(dir);
    expect(s1).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0, lastCommit: { pushed: true } });

    await writeFile(path.join(dir, 'f.txt'), '1\n2\n');
    await git('commit', '-q', '-am', 'iki');
    await writeFile(path.join(dir, 'f.txt'), '1\n2\n3\n');
    await git('commit', '-q', '-am', 'üç');
    const s2 = await getStatus(dir);
    expect(s2).toMatchObject({ ahead: 2, behind: 0, lastCommit: { message: 'üç', pushed: false } });

    // Başka bir klon ileri gider → behind.
    const other = path.join(tmp, `other-${counter++}`);
    await runGit(['clone', '-q', origin, other], tmp);
    await writeFile(path.join(other, 'g.txt'), 'g\n');
    await runGit([...CFG, 'add', '-A'], other);
    await runGit([...CFG, 'commit', '-q', '-m', 'öteki'], other);
    await runGit([...CFG, 'push', '-q'], other);
    await runOp(dir, opCommands({ kind: 'fetch' }));
    const s3 = await getStatus(dir);
    expect(s3).toMatchObject({ ahead: 2, behind: 1 });

    // Ayrışmış dalda ff-only pull → nonFastForward.
    const err: unknown = await runOp(dir, opCommands({ kind: 'pull' }, s3)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).kind).toBe('nonFastForward');
    // Push de reddedilir.
    const err2: unknown = await runOp(dir, opCommands({ kind: 'push' }, s3)).catch((e: unknown) => e);
    expect((err2 as GitError).kind).toBe('nonFastForward');
  });

  it('stash listesi ve stashCount', async () => {
    const { dir, git } = await makeRepo('stash');
    await writeFile(path.join(dir, 'f.txt'), '1\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'bir');
    await writeFile(path.join(dir, 'f.txt'), '2\n');
    await runOp(dir, opCommands({ kind: 'stashSave', includeUntracked: false }));
    await writeFile(path.join(dir, 'f.txt'), '3\n');
    await writeFile(path.join(dir, 'yeni.txt'), 'y\n');
    await runOp(dir, opCommands({ kind: 'stashSave', includeUntracked: true, message: 'yarım iş: ğüş' }));

    const s = await getStatus(dir);
    expect(s.stashCount).toBe(2);
    expect(s.files).toEqual([]);
    const list = await listStashes(dir);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ index: 0, message: 'yarım iş: ğüş', branch: 'main' });
    expect(list[1]).toMatchObject({ index: 1, branch: 'main' });
    expect(list[1]?.message).toMatch(/bir$/);
    expect(list[0]?.date).toBeGreaterThan(Date.now() - 3_600_000);

    await runOp(dir, opCommands({ kind: 'stashApply', index: 0, pop: true }));
    expect((await getStatus(dir)).stashCount).toBe(1);
    expect(await readFile(path.join(dir, 'yeni.txt'), 'utf8')).toBe('y\n');
  });
});

describe('runGit seçenekleri ve hata sınıfları', () => {
  it('timeout, input, env', async () => {
    const { dir } = await makeRepo('opts');
    const out = await runGit(['hash-object', '--stdin'], dir, { input: 'merhaba\n' });
    expect(out.trim()).toMatch(/^[0-9a-f]{40}$/);
    await expect(runGit(['var', 'GIT_EDITOR'], dir)).resolves.toMatch(/^true/);
    await expect(runGit(['var', 'GIT_EDITOR'], dir, { env: { GIT_EDITOR: 'nano' } })).resolves.toMatch(/^nano/);
    // credential fill normalde şifre sorar; prompt kapalı olduğundan beklemeden hata verir.
    await expect(
      runGit(['-c', 'credential.helper=', 'credential', 'fill'], dir, { input: 'protocol=https\nhost=example.invalid\n\n', env: { GIT_ASKPASS: '' } }),
    ).rejects.toBeInstanceOf(GitError);
    // Süre dolması makinenin hızına bağlı olmasın: "git" yerine uyuyan bir node süreci çalışır.
    setGitPath(process.execPath);
    const timedOut = await runGit(['-e', 'setTimeout(() => {}, 10000)'], dir, { timeoutMs: 100 })
      .catch((e: unknown) => e)
      .finally(() => setGitPath(undefined));
    expect(timedOut).toBeInstanceOf(GitError);
    expect((timedOut as GitError).timedOut).toBe(true);
  });

  it.each([
    ["fatal: Authentication failed for 'https://github.com/o/r.git/'", 'auth'],
    ['fatal: could not read Username for \'https://github.com\': terminal prompts disabled', 'auth'],
    ['git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', 'auth'],
    [' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs', 'nonFastForward'],
    [' ! [rejected]        main -> main (fetch first)', 'nonFastForward'],
    ['fatal: Not possible to fast-forward, aborting.', 'nonFastForward'],
    [' ! [rejected]        main -> main (stale info)', 'nonFastForward'],
    ['CONFLICT (content): Merge conflict in f.txt\nAutomatic merge failed; fix conflicts and then commit the result.', 'conflict'],
    ['error: could not apply 1234567... yan', 'conflict'],
    ['fatal: The current branch x has no upstream branch.', 'noUpstream'],
    ['There is no tracking information for the current branch.', 'noUpstream'],
    ['error: Your local changes to the following files would be overwritten by checkout:\n\tf.txt', 'dirtyTree'],
    ['error: cannot pull with rebase: You have unstaged changes.', 'dirtyTree'],
    ["fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com", 'network'],
    ['fatal: the remote end hung up unexpectedly', 'network'],
    ['error: pathspec x did not match', undefined],
  ])('%s → %s', (stderr, kind) => {
    expect(classifyGitError(stderr)).toBe(kind);
  });
});

describe('askpass', { timeout: 30_000 }, () => {
  const execFileP = promisify(execFile);
  const runScript = async (script: string, prompt: string, env: Record<string, string>) => {
    const fullEnv = { ...process.env, ...env };
    if (process.platform === 'win32') {
      return (await execFileP('cmd.exe', ['/d', '/c', script, prompt], { env: fullEnv, windowsHide: true })).stdout;
    }
    return (await execFileP(script, [prompt], { env: fullEnv })).stdout;
  };

  it('betik oluşur, kullanıcı adı/token basar, token dosyada yok, dispose siler', async () => {
    const token = 'ghp_TEST1234567890abcdef';
    const { env, dispose } = await createAskpassEnv(token);
    const script = env.GIT_ASKPASS ?? '';
    try {
      expect(env).toMatchObject({ RR_ASKPASS_TOKEN: token, GIT_TERMINAL_PROMPT: '0' });
      expect(path.dirname(script)).toBe(os.tmpdir());
      expect(await readFile(script, 'utf8')).not.toContain(token);

      expect((await runScript(script, "Username for 'https://github.com': ", env)).trim()).toBe('x-access-token');
      expect((await runScript(script, "Password for 'https://x-access-token@github.com': ", env)).trim()).toBe(token);

      // Uçtan uca: git askpass'ı kendisi çağırır.
      const { dir } = await makeRepo('askpass');
      const out = await runGit(['-c', 'credential.helper=', 'credential', 'fill'], dir, {
        env,
        input: 'protocol=https\nhost=github.com\n\n',
      });
      expect(out).toContain('username=x-access-token');
      expect(out).toContain(`password=${token}`);
    } finally {
      await dispose();
    }
    await expect(access(script)).rejects.toThrow();
  });
});
