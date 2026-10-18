import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitError, runGit, setGitPath } from '../src/git/gitRunner';
import { LOG_FORMAT, logArgs, parseNumstatLog } from '../src/git/logParser';

const RS = '\x1e';
const FS = '\x1f';

function header(f: { hash: string; parents: string; author?: string; at?: number; subject: string }): string {
  return (
    RS +
    [f.hash, f.hash.slice(0, 7), f.parents, f.author ?? 'Ayşe Yılmaz', 'ayse@example.com', String(f.at ?? 1700000000), f.subject].join(FS)
  );
}

describe('logArgs / LOG_FORMAT', () => {
  it('tam argüman listesini üretir', () => {
    expect(logArgs()).toEqual(['-c', 'core.quotepath=off', 'log', '--numstat', '-M', '--no-color', '--format=' + LOG_FORMAT]);
    expect(logArgs('HEAD~5..HEAD').at(-1)).toBe('HEAD~5..HEAD');
  });
});

describe('parseNumstatLog (sabit çıktı)', () => {
  it('boş girdi boş liste döner', () => {
    expect(parseNumstatLog('')).toEqual([]);
    expect(parseNumstatLog('\n')).toEqual([]);
  });

  it('normal commit', () => {
    const raw = header({ hash: 'a'.repeat(40), parents: 'b'.repeat(40), subject: 'feat: ekle' }) + '\n\n10\t2\tsrc/a.ts\n0\t5\tREADME.md\n';
    const [c] = parseNumstatLog(raw);
    expect(c).toEqual({
      hash: 'a'.repeat(40),
      shortHash: 'aaaaaaa',
      parents: ['b'.repeat(40)],
      author: 'Ayşe Yılmaz',
      email: 'ayse@example.com',
      date: 1700000000000,
      message: 'feat: ekle',
      files: [
        { path: 'src/a.ts', added: 10, deleted: 2 },
        { path: 'README.md', added: 0, deleted: 5 },
      ],
    });
    expect('oldPath' in (c?.files[0] ?? {})).toBe(false);
  });

  it('merge (2 parent, files boş), kök commit (parents []) ve sıra', () => {
    const raw =
      header({ hash: 'm'.repeat(40), parents: `${'p'.repeat(40)} ${'q'.repeat(40)}`, subject: "Merge branch 'x'" }) +
      '\n' +
      header({ hash: 'p'.repeat(40), parents: 'r'.repeat(40), subject: 'orta' }) +
      '\n\n1\t0\tf.txt\n' +
      header({ hash: 'r'.repeat(40), parents: '', subject: 'kök' }) +
      '\n\n3\t0\tf.txt\n';
    const commits = parseNumstatLog(raw);
    expect(commits.map((c) => c.message)).toEqual(["Merge branch 'x'", 'orta', 'kök']);
    expect(commits[0]?.parents).toHaveLength(2);
    expect(commits[0]?.files).toEqual([]);
    expect(commits[2]?.parents).toEqual([]);
  });

  it('binary dosya listede kalır, 0/0', () => {
    const raw = header({ hash: 'c'.repeat(40), parents: '', subject: 'logo' }) + '\n\n-\t-\tassets/logo.png\n4\t0\ta.txt\n';
    expect(parseNumstatLog(raw)[0]?.files).toEqual([
      { path: 'assets/logo.png', added: 0, deleted: 0 },
      { path: 'a.txt', added: 4, deleted: 0 },
    ]);
  });

  it('üç yeniden adlandırma biçimi + düz "=>"', () => {
    const raw =
      header({ hash: 'd'.repeat(40), parents: '', subject: 'taşı' }) +
      '\n\n0\t0\told.ts => new.ts\n' +
      '1\t1\tsrc/{a => b}/x.ts\n' +
      '0\t0\t{ => sub}/y.ts\n' +
      '0\t0\tsrc/{old => }/z.ts\n' +
      '2\t0\t{lib => src/lib}/w.ts\n';
    expect(parseNumstatLog(raw)[0]?.files).toEqual([
      { path: 'new.ts', oldPath: 'old.ts', added: 0, deleted: 0 },
      { path: 'src/b/x.ts', oldPath: 'src/a/x.ts', added: 1, deleted: 1 },
      { path: 'sub/y.ts', oldPath: 'y.ts', added: 0, deleted: 0 },
      { path: 'src/z.ts', oldPath: 'src/old/z.ts', added: 0, deleted: 0 },
      { path: 'src/lib/w.ts', oldPath: 'lib/w.ts', added: 2, deleted: 0 },
    ]);
  });

  it('Türkçe/özel karakterli ve boş mesaj, Türkçe yol', () => {
    const subject = 'düzelt: "ğüşıöç" İĞÜŞÖÇ => {a} \t | % ~';
    const raw =
      header({ hash: 'e'.repeat(40), parents: '', author: 'Çağrı Öztürk', subject }) +
      '\n\n1\t0\tbelgeler/çalışma.md\n' +
      header({ hash: 'f'.repeat(40), parents: '', subject: '' }) +
      '\n';
    const [a, b] = parseNumstatLog(raw);
    expect(a?.message).toBe(subject);
    expect(a?.author).toBe('Çağrı Öztürk');
    expect(a?.files).toEqual([{ path: 'belgeler/çalışma.md', added: 1, deleted: 0 }]);
    expect(b?.message).toBe('');
    expect(b?.files).toEqual([]);
  });

  it('tırnaklı (C-escape) yolları çözer', () => {
    const raw = header({ hash: 'g'.repeat(40), parents: '', subject: 's' }) + '\n\n1\t0\t"a\\tb.txt"\n1\t0\t"\\303\\247.txt"\n';
    expect(parseNumstatLog(raw)[0]?.files.map((f) => f.path)).toEqual(['a\tb.txt', 'ç.txt']);
  });

  it('CRLF satır sonlarına dayanıklı', () => {
    const lf =
      header({ hash: 'h'.repeat(40), parents: 'i'.repeat(40), subject: 'crlf' }) +
      '\n\n3\t1\tsrc/{a => b}/x.ts\n-\t-\tbin.dat\n' +
      header({ hash: 'i'.repeat(40), parents: '', subject: 'kök' }) +
      '\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(parseNumstatLog(crlf)).toEqual(parseNumstatLog(lf));
    expect(parseNumstatLog(crlf)[0]?.files[0]).toEqual({ path: 'src/b/x.ts', oldPath: 'src/a/x.ts', added: 3, deleted: 1 });
    expect(parseNumstatLog(crlf)[0]?.message).toBe('crlf');
  });
});

describe('gerçek geçici repo', () => {
  let dir = '';
  const git = (...args: string[]) =>
    runGit(
      ['-c', 'user.name=Test Kişi', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
      dir,
    );

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'gitatlas-revrev-log-'));
    await git('init', '-q', '-b', 'main');
    await mkdir(path.join(dir, 'src', 'old'), { recursive: true });
    await writeFile(path.join(dir, 'a.txt'), '1\n2\n3\n');
    await writeFile(path.join(dir, 'src', 'old', 'x.ts'), 'export const x = 1;\nexport const y = 2;\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'İlk commit: çğıöşü ÇĞİÖŞÜ', '--date', '1700000000 +0000');

    await mkdir(path.join(dir, 'src', 'new'), { recursive: true });
    await git('mv', 'src/old/x.ts', 'src/new/x.ts');
    await writeFile(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255, 0, 10, 0]));
    await git('add', '-A');
    await git('commit', '-q', '--allow-empty-message', '-m', '', '--date', '1700000100 +0000');

    await git('checkout', '-q', '-b', 'yan');
    await writeFile(path.join(dir, 'yan.txt'), 'yan\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'yan dal', '--date', '1700000200 +0000');
    await git('checkout', '-q', 'main');
    await writeFile(path.join(dir, 'a.txt'), '1\n2\n3\n4\n');
    await git('commit', '-q', '-am', 'a.txt güncelle', '--date', '1700000300 +0000');
    await git('merge', '-q', '--no-ff', '-m', 'Merge yan', 'yan');
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('runGit(logArgs()) çıktısı doğru ayrıştırılır', async () => {
    const commits = parseNumstatLog(await runGit(logArgs(), dir));
    expect(commits).toHaveLength(5);
    const byMsg = new Map(commits.map((c) => [c.message, c]));

    const merge = commits[0];
    expect(merge?.message).toBe('Merge yan');
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.files).toEqual([]);

    const root = byMsg.get('İlk commit: çğıöşü ÇĞİÖŞÜ');
    expect(root?.parents).toEqual([]);
    expect(root?.date).toBe(1700000000000);
    expect(root?.author).toBe('Test Kişi');
    expect(root?.email).toBe('test@example.com');
    expect(root?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(root?.hash.startsWith(root.shortHash)).toBe(true);
    expect(root?.files).toEqual([
      { path: 'a.txt', added: 3, deleted: 0 },
      { path: 'src/old/x.ts', added: 2, deleted: 0 },
    ]);

    const mv = byMsg.get('');
    expect(mv?.date).toBe(1700000100000);
    expect(mv?.files).toEqual(
      expect.arrayContaining([
        { path: 'bin.dat', added: 0, deleted: 0 },
        { path: 'src/new/x.ts', oldPath: 'src/old/x.ts', added: 0, deleted: 0 },
      ]),
    );
    expect(mv?.files).toHaveLength(2);

    expect(byMsg.get('a.txt güncelle')?.files).toEqual([{ path: 'a.txt', added: 1, deleted: 0 }]);
    // En yeniden en eskiye.
    expect(commits.at(-1)?.message).toBe('İlk commit: çğıöşü ÇĞİÖŞÜ');
  });

  it('repo olmayan klasörde notRepo hatası', async () => {
    const plain = await mkdtemp(path.join(os.tmpdir(), 'gitatlas-revrev-norepo-'));
    try {
      await expect(runGit(['-c', 'safe.directory=*', 'status'], plain)).rejects.toMatchObject({ code: 'notRepo' });
      await expect(runGit(['status'], plain)).rejects.toBeInstanceOf(GitError);
    } finally {
      await rm(plain, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('geçersiz komutta failed hatası', async () => {
    await expect(runGit(['log', 'olmayan-ref-xyz'], dir)).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('.mailmap ve setGitPath', () => {
  let dir = '';
  const commitAs = async (name: string, email: string, file: string) => {
    await writeFile(path.join(dir, file), `${file}\n`);
    await runGit(['add', '-A'], dir);
    await runGit(['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', file], dir);
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'gitatlas-revrev-mailmap-'));
    await runGit(['init', '-q', '-b', 'main'], dir);
    await commitAs('Ali Veli', 'ali@is.example.com', 'a.txt');
    await commitAs('ali', 'ali@ev.example.com', 'b.txt');
    await writeFile(path.join(dir, '.mailmap'), 'Ali Veli <ali@is.example.com> ali <ali@ev.example.com>\n');
    await commitAs('Ali Veli', 'ali@is.example.com', '.keep');
  });

  afterAll(async () => {
    setGitPath(undefined);
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('iki e-posta tek yazara iner', async () => {
    const commits = parseNumstatLog(await runGit(logArgs(), dir));
    expect(commits).toHaveLength(3);
    expect(new Set(commits.map((c) => `${c.author} <${c.email}>`))).toEqual(new Set(['Ali Veli <ali@is.example.com>']));
  });

  it('setGitPath: geçersiz yol notFound, boş değer varsayılana döner', async () => {
    setGitPath(path.join(dir, 'olmayan-git.exe'));
    await expect(runGit(['--version'], dir)).rejects.toMatchObject({ code: 'notFound' });
    setGitPath('  ');
    await expect(runGit(['--version'], dir)).resolves.toMatch(/git version/);
    setGitPath(undefined);
  });
});
