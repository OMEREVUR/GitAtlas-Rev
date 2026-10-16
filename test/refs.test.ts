import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitRef } from '../src/types';
import { runGit } from '../src/git/gitRunner';
import { graphLogArgs } from '../src/git/graphLog';
import { parseNumstatLog } from '../src/git/logParser';
import { listRefs } from '../src/git/refs';

const CFG = ['-c', 'user.name=Test Kişi', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.autocrlf=false'];

describe('listRefs + graphLogArgs (gerçek repo)', () => {
  let tmp = '';
  let work = '';
  const git = (...args: string[]) => runGit([...CFG, ...args], work);
  let n = 0;
  const commit = async (msg: string) => {
    await writeFile(path.join(work, `f${n++}.txt`), `${msg}\n`);
    await git('add', '-A');
    await git('commit', '-q', '-m', msg);
    return (await git('rev-parse', 'HEAD')).trim();
  };
  const byName = (refs: GitRef[], name: string) => {
    const r = refs.find((x) => x.name === name);
    if (!r) throw new Error(`ref yok: ${name}`);
    return r;
  };
  const h: Record<string, string> = {};

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'rewiewrev-refs-'));
    const origin = path.join(tmp, 'origin.git');
    work = path.join(tmp, 'work');
    await runGit(['init', '-q', '--bare', origin], tmp);
    await runGit(['init', '-q', '-b', 'main', work], tmp);
    await git('remote', 'add', 'origin', origin);

    h.c1 = await commit('c1');
    h.c2 = await commit('c2');
    await git('checkout', '-q', '-b', 'side', h.c1);
    h.s1 = await commit('s1');
    await git('checkout', '-q', 'main');
    await git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
    h.merge = (await git('rev-parse', 'HEAD')).trim();
    await git('branch', '-q', '-D', 'side');
    await git('push', '-q', '-u', 'origin', 'main');
    await git('remote', 'set-head', 'origin', 'main');

    // Upstream'i silinmiş branch: [gone].
    await git('checkout', '-q', '-b', 'gone-br');
    await git('push', '-q', '-u', 'origin', 'gone-br');
    await git('push', '-q', 'origin', '--delete', 'gone-br');
    await git('fetch', '-q', '--prune', 'origin');
    await git('checkout', '-q', 'main');

    h.m3 = await commit('m3');
    h.m4 = await commit('m4');

    // Yalnızca ileride: main'in ucundan +1.
    await git('checkout', '-q', '-b', 'feat/ahead');
    h.fa = await commit('fa');
    // İleride ve geride: c2'den +2.
    await git('checkout', '-q', '-b', 'feat/both', h.c2);
    await commit('fb1');
    h.fb2 = await commit('fb2');
    await git('checkout', '-q', 'main');

    await git('tag', '-a', 'v1.0', '-m', 'sürüm 1.0', h.c1);
    await git('tag', 'v0.1', h.c2);
  });

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('branch ve etiketleri doğru türler ve hash\'lerle listeler', async () => {
    const refs = await listRefs(work);
    expect(refs.map((r) => r.name).sort()).toEqual(
      ['feat/ahead', 'feat/both', 'gone-br', 'main', 'origin/main', 'v0.1', 'v1.0'].sort(),
    );
    expect(refs.some((r) => r.fullName === 'refs/remotes/origin/HEAD')).toBe(false);

    const main = byName(refs, 'main');
    expect(main).toMatchObject({ fullName: 'refs/heads/main', kind: 'local', hash: h.m4, isHead: true, subject: 'm4', author: 'Test Kişi' });
    expect(main.date).toBeGreaterThan(Date.now() - 3_600_000);

    const tag = byName(refs, 'v1.0');
    expect(tag).toMatchObject({ kind: 'tag', hash: h.c1, subject: 'c1', author: 'Test Kişi', isHead: false });
    expect(tag.date).toBeGreaterThan(0);
    expect(tag.ahead).toBeUndefined();
    expect(byName(refs, 'v0.1')).toMatchObject({ kind: 'tag', hash: h.c2, subject: 'c2' });
    expect(byName(refs, 'origin/main')).toMatchObject({ kind: 'remote', hash: h.merge, isHead: false });
  });

  it('ahead/behind kuralları', async () => {
    const refs = await listRefs(work);
    // Upstream'e göre (track).
    expect(byName(refs, 'main')).toMatchObject({ upstream: 'origin/main', compareTo: 'origin/main', ahead: 2, behind: 0 });
    // Upstream yok → varsayılan (HEAD) branch'e göre.
    const fa = byName(refs, 'feat/ahead');
    expect(fa).toMatchObject({ compareTo: 'main', ahead: 1, behind: 0 });
    expect(fa.upstream).toBeUndefined();
    // main'de c2'den sonra: s1, merge, m3, m4.
    expect(byName(refs, 'feat/both')).toMatchObject({ compareTo: 'main', ahead: 2, behind: 4 });
    // [gone] → upstream yok sayılır.
    const gone = byName(refs, 'gone-br');
    expect(gone.upstream).toBeUndefined();
    expect(gone).toMatchObject({ compareTo: 'main', ahead: 0, behind: 2 });
    // Remote → aynı adlı lokal branch'e göre.
    expect(byName(refs, 'origin/main')).toMatchObject({ compareTo: 'main', ahead: 0, behind: 2 });
  });

  it('detached HEAD: varsayılan branch main olur', async () => {
    await git('checkout', '-q', '--detach', h.fb2);
    try {
      const refs = await listRefs(work);
      expect(refs.some((r) => r.isHead)).toBe(false);
      expect(byName(refs, 'main')).toMatchObject({ compareTo: 'origin/main', ahead: 2, behind: 0 });
      expect(byName(refs, 'feat/both')).toMatchObject({ compareTo: 'main', ahead: 2, behind: 4 });
      expect(byName(refs, 'feat/ahead')).toMatchObject({ compareTo: 'main', ahead: 1, behind: 0 });
    } finally {
      await git('checkout', '-q', 'main');
    }
  });

  it('HEAD başka branch\'teyken o varsayılan olur', async () => {
    await git('checkout', '-q', 'feat/ahead');
    try {
      const refs = await listRefs(work);
      expect(byName(refs, 'feat/ahead').isHead).toBe(true);
      expect(byName(refs, 'feat/ahead').ahead).toBeUndefined();
      expect(byName(refs, 'feat/both')).toMatchObject({ compareTo: 'feat/ahead', ahead: 2, behind: 5 });
    } finally {
      await git('checkout', '-q', 'main');
    }
  });

  it('graphLogArgs: tüm branch\'ler, topo sırası, merge 2 parent', async () => {
    const commits = parseNumstatLog(await git(...graphLogArgs({ limit: 100 })));
    const hashes = new Set(commits.map((c) => c.hash));
    for (const k of ['c1', 'c2', 's1', 'merge', 'm3', 'm4', 'fa', 'fb2'] as const) expect(hashes.has(h[k] ?? '')).toBe(true);
    expect(commits).toHaveLength(9);
    const merge = commits.find((c) => c.hash === h.merge);
    expect(merge?.parents).toEqual([h.c2, h.s1]);
    expect(merge?.files).toEqual([]);
    // Topo sırası: her commit parent'larından önce gelir.
    const idx = new Map(commits.map((c, i) => [c.hash, i]));
    for (const c of commits) for (const p of c.parents) expect(idx.get(p) ?? -1).toBeGreaterThan(idx.get(c.hash) ?? 0);

    expect(parseNumstatLog(await git(...graphLogArgs({ limit: 3 })))).toHaveLength(3);
    const both = parseNumstatLog(await git(...graphLogArgs({ limit: 100, branch: 'feat/both' })));
    expect(both.map((c) => c.message)).toEqual(['fb2', 'fb1', 'c2', 'c1']);
  });

  it('graphLogArgs argümanları', () => {
    const a = graphLogArgs({ limit: 500 });
    expect(a.slice(-7)).toEqual(['-n', '500', '--branches', '--remotes', '--tags', 'HEAD', '--']);
    expect(a).not.toContain('--all');
    expect(graphLogArgs({ limit: 10, branch: 'dev' }).slice(-4)).toEqual(['-n', '10', 'dev', '--']);
  });

  it('boş repo → [], repo değil → notRepo', async () => {
    const empty = path.join(tmp, 'empty');
    await runGit(['init', '-q', empty], tmp);
    expect(await listRefs(empty)).toEqual([]);
    const plain = await mkdtemp(path.join(os.tmpdir(), 'rewiewrev-norepo-'));
    try {
      await expect(listRefs(plain)).rejects.toMatchObject({ code: 'notRepo' });
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
