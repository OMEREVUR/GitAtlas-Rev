import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { conflictKindFromXY, sideExists, sideRole } from '../src/git/conflictSides';
import { opCommands } from '../src/git/opCommands';
import { getStatus } from '../src/git/status';
import { setLang } from '../src/i18n';
import { GitOpsService, type OpsUi } from '../src/ops/gitOpsService';
import type { GitOpRequest, WorkingTreeStatus } from '../src/types';

const T = 60_000;
const temps: string[] = [];

afterAll(async () => {
  setLang('tr');
  for (const t of temps) await rm(t, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Çakışmayla biten git komutu (çıkış kodu 1 beklenir). */
function gitFails(cwd: string, ...args: string[]): void {
  try {
    git(cwd, ...args);
  } catch {
    return;
  }
  throw new Error(`git ${args.join(' ')} çakışmasız bitti`);
}

const write = (repo: string, path: string, text: string): Promise<void> => writeFile(join(repo, path), text, 'utf8');

/** main ve yan branch'inde a.txt'yi farklı değiştirmiş bir repo (çakışma için hazır). */
async function diverged(yan: (repo: string) => Promise<void>, main: (repo: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gitatlas-rev-resolve-'));
  temps.push(dir);
  const repo = join(dir, 'repo');
  git(dir, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'commit.gpgsign', 'false');
  await write(repo, 'a.txt', 'ilk\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'ilk');
  git(repo, 'switch', '-q', '-c', 'yan');
  await yan(repo);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'yan');
  git(repo, 'switch', '-q', 'main');
  await main(repo);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'ana');
  return repo;
}

class FakeUi implements OpsUi {
  readonly asked: string[] = [];
  constructor(private readonly answers: boolean[]) {}
  confirm(message: string, detail: string, action: string): Promise<boolean> {
    this.asked.push(`${message}|${detail}|${action}`);
    return Promise.resolve(this.answers.shift() ?? false);
  }
  pick<T extends string>(): Promise<T | undefined> {
    return Promise.resolve(undefined);
  }
}

let seq = 0;
function service(repo: string, answers: boolean[]): { run: (op: GitOpRequest) => ReturnType<GitOpsService['run']>; ui: FakeUi } {
  const ui = new FakeUi(answers);
  const svc = new GitOpsService({ root: repo, ui, pullStrategy: () => 'ask', log: () => undefined });
  return { run: (op) => svc.run(`r${++seq}`, op), ui };
}

describe('conflictSides (saf)', () => {
  it('porcelain XY → çakışma türü', () => {
    expect(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'].map(conflictKindFromXY)).toEqual([
      'bothModified', 'bothAdded', 'bothDeleted', 'addedByUs', 'addedByThem', 'deletedByUs', 'deletedByThem',
    ]);
  });

  it('rebase\'de taraflar ters: --ours hedef branch, --theirs senin commit\'in', () => {
    expect(sideRole('merge', 'ours')).toBe('current');
    expect(sideRole('merge', 'theirs')).toBe('incoming');
    expect(sideRole('rebase', 'ours')).toBe('onto');
    expect(sideRole('rebase', 'theirs')).toBe('yours');
    expect(sideRole('cherryPick', 'theirs')).toBe('picked');
    expect(sideRole(undefined, 'theirs')).toBe('incoming');
  });

  it('silinmiş tarafta sürüm yok', () => {
    expect(sideExists('bothModified', 'ours')).toBe(true);
    expect(sideExists('deletedByThem', 'theirs')).toBe(false);
    expect(sideExists('deletedByThem', 'ours')).toBe(true);
    expect(sideExists('deletedByUs', 'ours')).toBe(false);
    expect(sideExists('addedByUs', 'theirs')).toBe(false);
    expect(sideExists('bothDeleted', 'ours')).toBe(false);
  });

  it('opCommands: taraf varsa checkout + add, yoksa rm', () => {
    const status = (conflict: WorkingTreeStatus['files'][number]['conflict']): WorkingTreeStatus => ({
      ahead: 0, behind: 0, stashCount: 0, files: [{ path: 'a.txt', conflicted: true, conflict }],
    });
    expect(opCommands({ kind: 'resolveSide', path: 'a.txt', side: 'theirs' }, status('bothModified'))).toEqual([
      ['checkout', '--theirs', '--', 'a.txt'],
      ['add', '--', 'a.txt'],
    ]);
    expect(opCommands({ kind: 'resolveSide', path: 'a.txt', side: 'theirs' }, status('deletedByThem'))).toEqual([['rm', '--', 'a.txt']]);
  });
});

describe('resolveSide (gerçek git)', () => {
  it('merge: gelen tarafı alır, çözüldü işaretler; vazgeçilirse dokunmaz', async () => {
    setLang('tr');
    const repo = await diverged((r) => write(r, 'a.txt', 'yan\n'), (r) => write(r, 'a.txt', 'ana\n'));
    gitFails(repo, 'merge', '--no-edit', 'yan');
    const st = await getStatus(repo);
    expect(st.operation).toBe('merge');
    expect(st.files.find((f) => f.path === 'a.txt')).toMatchObject({ conflicted: true, conflict: 'bothModified' });

    const { run, ui } = service(repo, [false, true]);
    const no = await run({ kind: 'resolveSide', path: 'a.txt', side: 'theirs' });
    expect(no.cancelled).toBe(true);
    expect((await getStatus(repo)).files[0]?.conflicted).toBe(true);

    const yes = await run({ kind: 'resolveSide', path: 'a.txt', side: 'theirs' });
    expect(yes).toMatchObject({
      ok: true,
      commands: ['git checkout --theirs -- a.txt', 'git add -- a.txt'],
      message: "a.txt: gelen branch'teki sürüm alındı, çözüldü olarak işaretlendi.",
    });
    expect(ui.asked[0]).toBe(
      "a.txt: gelen branch'teki sürüm alınsın mı?|Diğer taraftaki değişiklikler (mevcut branch'teki (HEAD)) bu dosyadan atılır ve dosya çözüldü olarak işaretlenir.|Bu sürümü al",
    );
    expect((await readFile(join(repo, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('yan\n');
    expect((await getStatus(repo)).files.some((f) => f.conflicted)).toBe(false);
  }, T);

  it('rebase: etiketler ters çevrilir; "senin commit\'in" yeniden uygulanan commit\'in sürümüdür', async () => {
    setLang('en');
    const repo = await diverged((r) => write(r, 'a.txt', 'yan\n'), (r) => write(r, 'a.txt', 'ana\n'));
    git(repo, 'switch', '-q', 'yan');
    gitFails(repo, 'rebase', 'main');
    expect((await getStatus(repo)).operation).toBe('rebase');

    const { run, ui } = service(repo, [true]);
    const r = await run({ kind: 'resolveSide', path: 'a.txt', side: 'theirs' });
    expect(r.message).toBe('a.txt: kept the version from your commit and marked it resolved.');
    expect(ui.asked[0]).toContain('Changes from the other side (the branch you are rebasing onto)');
    expect((await readFile(join(repo, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('yan\n');
  }, T);

  it('karşı taraf dosyayı sildiyse o tarafı seçmek dosyayı siler (git rm)', async () => {
    setLang('tr');
    const repo = await diverged(
      async (r) => {
        await rm(join(r, 'a.txt'));
      },
      (r) => write(r, 'a.txt', 'ana\n'),
    );
    gitFails(repo, 'merge', '--no-edit', 'yan');
    expect((await getStatus(repo)).files.find((f) => f.path === 'a.txt')?.conflict).toBe('deletedByThem');

    const { run, ui } = service(repo, [true]);
    const r = await run({ kind: 'resolveSide', path: 'a.txt', side: 'theirs' });
    expect(r).toMatchObject({ ok: true, commands: ['git rm -- a.txt'], message: 'a.txt silindi, çözüldü olarak işaretlendi.' });
    expect(ui.asked[0]).toContain('Dosyayı sil');
    expect(existsSync(join(repo, 'a.txt'))).toBe(false);
    expect((await getStatus(repo)).files.some((f) => f.conflicted)).toBe(false);
  }, T);

  it('çakışmasız dosyada hata verir, onay sormaz', async () => {
    setLang('tr');
    const repo = await diverged((r) => write(r, 'a.txt', 'yan\n'), (r) => write(r, 'a.txt', 'ana\n'));
    const { run, ui } = service(repo, [true]);
    const r = await run({ kind: 'resolveSide', path: 'a.txt', side: 'ours' });
    expect(r).toMatchObject({ ok: false, message: 'a.txt dosyasında çakışma yok.' });
    expect(ui.asked).toEqual([]);
  }, T);
});
