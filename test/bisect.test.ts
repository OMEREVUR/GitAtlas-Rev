import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getBisectState, parseBisectLog, parseBisectRefs, remainingSteps } from '../src/git/bisect';
import { opCommands } from '../src/git/opCommands';
import { setLang } from '../src/i18n';
import { GitOpsService, type OpsUi } from '../src/ops/gitOpsService';
import type { GitOpRequest } from '../src/types';

const T = 120_000;
const temps: string[] = [];

afterAll(async () => {
  setLang('tr');
  for (const t of temps) await rm(t, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 16 commit'lik repo; app.txt 11. commit'te "bug" olur. Commit hash'leri eskiden yeniye döner. */
async function buggyRepo(): Promise<{ repo: string; hashes: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'gitatlas-rev-bisect-'));
  temps.push(dir);
  const repo = join(dir, 'repo');
  git(dir, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const hashes: string[] = [];
  for (let i = 1; i <= 16; i++) {
    await writeFile(join(repo, 'app.txt'), i >= 11 ? `bug ${i}\n` : `ok ${i}\n`, 'utf8');
    await writeFile(join(repo, 'notes.txt'), `not ${i}\n`, 'utf8');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', `commit ${i}`);
    hashes.push(git(repo, 'rev-parse', 'HEAD'));
  }
  return { repo, hashes };
}

class FakeUi implements OpsUi {
  readonly asked: string[] = [];
  constructor(private readonly answers: boolean[] = []) {}
  confirm(message: string): Promise<boolean> {
    this.asked.push(message);
    return Promise.resolve(this.answers.shift() ?? false);
  }
  pick<T extends string>(): Promise<T | undefined> {
    return Promise.resolve(undefined);
  }
}

let seq = 0;
function service(repo: string, answers: boolean[] = []): { run: (op: GitOpRequest) => ReturnType<GitOpsService['run']>; ui: FakeUi } {
  const ui = new FakeUi(answers);
  const svc = new GitOpsService({ root: repo, ui, pullStrategy: () => 'ask', log: () => undefined });
  return { run: (op) => svc.run(`b${++seq}`, op), ui };
}

const isBuggy = async (repo: string): Promise<boolean> => (await readFile(join(repo, 'app.txt'), 'utf8')).startsWith('bug');

describe('bisect (saf)', () => {
  it('BISECT_LOG: işaretler ve bulunan commit', () => {
    const log = [
      "git bisect start 'main' 'abc1234'",
      '# bad: [1111111111111111111111111111111111111111] commit 16',
      '# good: [2222222222222222222222222222222222222222] commit 1',
      'git bisect good 2222222',
      '# skip: [3333333333333333333333333333333333333333] commit 8',
      '# first bad commit: [4444444444444444444444444444444444444444] commit 11',
    ].join('\n');
    const p = parseBisectLog(log);
    expect(p.marks.map((m) => `${m.mark}:${m.hash.slice(0, 1)}:${m.subject}`)).toEqual(['bad:1:commit 16', 'good:2:commit 1', 'skip:3:commit 8']);
    expect(p.firstBad).toBe('4'.repeat(40));
  });

  it('refs/bisect ayrıştırma ve kalan adım', () => {
    const r = parseBisectRefs('refs/bisect/bad aaa\nrefs/bisect/good-bbb bbb\nrefs/bisect/skip-ccc ccc\n');
    expect(r).toEqual({ bad: 'aaa', goods: ['bbb'], skips: ['ccc'] });
    expect([0, 1, 2, 3, 15, 16, 17].map(remainingSteps)).toEqual([0, 0, 1, 2, 4, 4, 5]);
  });

  it('komutlar', () => {
    expect(opCommands({ kind: 'bisectStart', bad: 'HEAD', good: 'v1.0' })).toEqual([['bisect', 'start', 'HEAD', 'v1.0']]);
    expect(opCommands({ kind: 'bisectMark', mark: 'skip' })).toEqual([['bisect', 'skip']]);
    expect(opCommands({ kind: 'bisectMark', mark: 'good', rev: 'abc1234' })).toEqual([['bisect', 'good', 'abc1234']]);
    expect(opCommands({ kind: 'bisectReset' })).toEqual([['bisect', 'reset']]);
  });
});

describe('bisect (gerçek git)', () => {
  it('iyi/kötü işaretleyerek hatayı getiren commit\'i bulur; bitirince branch\'e döner', async () => {
    setLang('tr');
    const { repo, hashes } = await buggyRepo();
    const { run } = service(repo);
    expect(await getBisectState(repo)).toBeUndefined();

    const s = await run({ kind: 'bisectStart', bad: 'HEAD', good: hashes[0] ?? '' });
    expect(s.ok).toBe(true);
    expect(s.commands).toEqual([`git bisect start HEAD ${hashes[0]}`]);
    expect(s.message).toMatch(/^Test et: [0-9a-f]{7} commit \d+ · yaklaşık \d adım kaldı\.$/);
    const first = await getBisectState(repo);
    expect(first).toMatchObject({ startRef: 'main', bad: hashes[15], goods: [hashes[0]], candidateCount: 15, steps: 4 });

    let last = s;
    for (let i = 0; i < 10; i++) {
      const state = await getBisectState(repo);
      if (state?.firstBad) break;
      last = await run({ kind: 'bisectMark', mark: (await isBuggy(repo)) ? 'bad' : 'good' });
      expect(last.ok).toBe(true);
    }
    const done = await getBisectState(repo);
    expect(done?.firstBad).toBe(hashes[10]);
    expect(done?.steps).toBe(0);
    expect(last.message).toBe(`Hatayı getiren commit bulundu: ${hashes[10]?.slice(0, 7)} commit 11`);
    expect(done?.marks.length).toBeGreaterThanOrEqual(4);

    const r = await run({ kind: 'bisectReset' });
    expect(r).toMatchObject({ ok: true, message: 'Bisect bitti; geri dönüldü: main' });
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(await getBisectState(repo)).toBeUndefined();
    expect((await run({ kind: 'bisectReset' })).message).toBe('Süren bir bisect yok.');
  }, T);

  it('atla (skip) ile de bulunur; terminalden başlatılan bisect algılanır', async () => {
    setLang('en');
    const { repo, hashes } = await buggyRepo();
    git(repo, 'bisect', 'start', 'HEAD', hashes[0] ?? '');
    const detected = await getBisectState(repo);
    expect(detected).toMatchObject({ startRef: 'main', candidateCount: 15 });
    expect(detected?.current).toBe(git(repo, 'rev-parse', 'HEAD'));

    const { run } = service(repo);
    const skipped = await run({ kind: 'bisectMark', mark: 'skip' });
    expect(skipped.ok).toBe(true);
    expect((await getBisectState(repo))?.skips).toHaveLength(1);
    for (let i = 0; i < 12; i++) {
      if ((await getBisectState(repo))?.firstBad) break;
      await run({ kind: 'bisectMark', mark: (await isBuggy(repo)) ? 'bad' : 'good' });
    }
    expect((await getBisectState(repo))?.firstBad).toBe(hashes[10]);
    expect((await run({ kind: 'bisectStart', bad: 'HEAD', good: hashes[0] ?? '' })).message).toBe('A bisect is already in progress.');
  }, T);

  it('kirli ağaçta önce onay ister; onaylanınca stash yapıp başlar', async () => {
    setLang('tr');
    const { repo, hashes } = await buggyRepo();
    await writeFile(join(repo, 'notes.txt'), 'yerel değişiklik\n', 'utf8');

    const no = service(repo, [false]);
    expect((await no.run({ kind: 'bisectStart', bad: 'HEAD', good: hashes[0] ?? '' })).cancelled).toBe(true);
    expect(no.ui.asked).toEqual(['Çalışma ağacında commit edilmemiş değişiklik var.']);
    expect(await getBisectState(repo)).toBeUndefined();

    const yes = service(repo, [true]);
    const r = await yes.run({ kind: 'bisectStart', bad: 'HEAD', good: hashes[0] ?? '' });
    expect(r.ok).toBe(true);
    expect(r.commands[0]).toBe('git stash push -m "GitAtlas-Rev: bisect"');
    expect(git(repo, 'stash', 'list')).toContain('GitAtlas-Rev: bisect');
    expect(await getBisectState(repo)).toBeDefined();
  }, T);
});
