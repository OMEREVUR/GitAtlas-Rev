// 0.4.0: cherry-pick ve "bu commit'i atla" — gerçek git'e karşı.
// Düzen test/gitOps.test.ts ile aynı: geçici repo + FakeUi ile senaryolanmış onaylar.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getStatus } from '../src/git/status';
import { GitOpsService, type OpsDeps, type OpsUi } from '../src/ops/gitOpsService';
import type { GitOpRequest, OpResult } from '../src/types';

const T = 60_000;
const temps: string[] = [];

afterAll(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function write(repo: string, path: string, text: string): Promise<void> {
  await writeFile(join(repo, path), text, 'utf8');
}

interface Fixture {
  repo: string;
  /** feature dalındaki commit'ler: f1 ve f2 main ile çakışmaz, f3 çakışır. */
  f1: string;
  f2: string;
  f3: string;
}

/**
 * main:    ilk → m1 (a.txt'in ilk satırını değiştirir)
 * feature: ilk → f1 (c.txt) → f2 (c.txt) → f3 (a.txt'in ilk satırını değiştirir → m1 ile çakışır)
 * HEAD = main, çalışma ağacı temiz.
 */
async function setup(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'gitatlas-revrev-pick-'));
  temps.push(dir);
  const repo = join(dir, 'repo');
  git(dir, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.name', 'Test Kisi');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'commit.gpgsign', 'false');

  await write(repo, 'a.txt', 'bir\niki\nüç\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'ilk');

  git(repo, 'checkout', '-q', '-b', 'feature');
  await write(repo, 'c.txt', 'c1\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'f1');
  const f1 = git(repo, 'rev-parse', 'HEAD');
  await write(repo, 'c.txt', 'c1\nc2\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'f2');
  const f2 = git(repo, 'rev-parse', 'HEAD');
  await write(repo, 'a.txt', 'FEATURE\niki\nüç\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'f3');
  const f3 = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'main');
  await write(repo, 'a.txt', 'MAIN\niki\nüç\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'm1');

  return { repo, f1, f2, f3 };
}

class FakeUi implements OpsUi {
  readonly asked: string[] = [];
  constructor(private readonly confirms: boolean[] = []) {}
  confirm(message: string, detail: string, action: string): Promise<boolean> {
    this.asked.push(`confirm:${message}|${detail}|${action}`);
    return Promise.resolve(this.confirms.shift() ?? false);
  }
  pick<T extends string>(_title: string, _items: { id: T; label: string }[]): Promise<T | undefined> {
    return Promise.resolve(undefined);
  }
}

function service(repo: string, opts: Partial<OpsDeps> & { ui?: OpsUi } = {}): { svc: GitOpsService; ui: FakeUi } {
  const ui = (opts.ui as FakeUi | undefined) ?? new FakeUi();
  const svc = new GitOpsService({ root: repo, ui, pullStrategy: () => 'ask', log: () => undefined, ...opts });
  return { svc, ui };
}

let seq = 0;
const run = (svc: GitOpsService, op: GitOpRequest): Promise<OpResult> => svc.run(`op${++seq}`, op);

/** Commit konuları, yeniden eskiye. */
const subjects = (repo: string, n: number): string[] => git(repo, 'log', `-${n}`, '--format=%s').split('\n');

describe('cherryPick', () => {
  it(
    'tek commit: yeni commit oluşur, -x satırı mesaja düşer, onay sorulmaz',
    async () => {
      const { repo, f1 } = await setup();
      const { svc, ui } = service(repo);
      const r = await run(svc, { kind: 'cherryPick', hashes: [f1] });

      expect(r.ok).toBe(true);
      expect(ui.asked).toEqual([]); // tek commit → onay yok
      expect(r.commands).toEqual([`git cherry-pick -x ${f1}`]);
      expect(subjects(repo, 1)).toEqual(['f1']);
      expect(git(repo, 'log', '-1', '--format=%B')).toContain(`(cherry picked from commit ${f1})`);
      // main'in kendi değişikliği duruyor
      expect(git(repo, 'show', 'HEAD:a.txt')).toContain('MAIN');
    },
    T,
  );

  it(
    'birden fazla commit: onay istenir ve eskiden yeniye uygulanır',
    async () => {
      const { repo, f1, f2 } = await setup();
      const { svc, ui } = service(repo, { ui: new FakeUi([true]) });
      const r = await run(svc, { kind: 'cherryPick', hashes: [f1, f2] });

      expect(r.ok).toBe(true);
      expect(ui.asked).toHaveLength(1);
      expect(ui.asked[0]).toContain('2');
      // log yeniden eskiye: f2 üstte → f1 önce uygulanmış
      expect(subjects(repo, 2)).toEqual(['f2', 'f1']);
      expect(git(repo, 'show', 'HEAD:c.txt')).toBe('c1\nc2');
    },
    T,
  );

  it(
    'onay reddedilirse hiçbir şey yapılmaz',
    async () => {
      const { repo, f1, f2 } = await setup();
      const { svc } = service(repo, { ui: new FakeUi([false]) });
      const before = git(repo, 'rev-parse', 'HEAD');
      const r = await run(svc, { kind: 'cherryPick', hashes: [f1, f2] });

      expect(r.ok).toBe(false);
      expect(r.cancelled).toBe(true);
      expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    },
    T,
  );

  it(
    'kirli ağaçta reddedilir; untracked dosya engel değildir',
    async () => {
      const { repo, f1 } = await setup();
      const { svc } = service(repo);

      await write(repo, 'a.txt', 'KIRLI\niki\nüç\n');
      const dirty = await run(svc, { kind: 'cherryPick', hashes: [f1] });
      expect(dirty.ok).toBe(false);
      expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

      git(repo, 'checkout', '--', 'a.txt');
      await write(repo, 'yeni.txt', 'izlenmiyor\n');
      const ok = await run(svc, { kind: 'cherryPick', hashes: [f1] });
      expect(ok.ok).toBe(true);
    },
    T,
  );

  it(
    'boş liste ve süren işlem reddedilir',
    async () => {
      const { repo, f1, f3 } = await setup();
      const { svc } = service(repo);

      expect((await run(svc, { kind: 'cherryPick', hashes: [] })).ok).toBe(false);

      // f3 çakışır → cherry-pick yarıda kalır
      await run(svc, { kind: 'cherryPick', hashes: [f3] });
      expect((await getStatus(repo)).operation).toBe('cherryPick');
      const second = await run(svc, { kind: 'cherryPick', hashes: [f1] });
      expect(second.ok).toBe(false);
    },
    T,
  );
});

describe('cherry-pick çakışması', () => {
  it(
    'çakışmada durur; çözülüp devam edilince biter',
    async () => {
      const { repo, f3 } = await setup();
      const { svc } = service(repo);

      const r = await run(svc, { kind: 'cherryPick', hashes: [f3] });
      expect(r.ok).toBe(false);
      const during = await getStatus(repo);
      expect(during.operation).toBe('cherryPick');
      expect(during.files.filter((f) => f.conflicted).map((f) => f.path)).toEqual(['a.txt']);

      await write(repo, 'a.txt', 'ÇÖZÜLDÜ\niki\nüç\n');
      expect((await run(svc, { kind: 'markResolved', paths: ['a.txt'] })).ok).toBe(true);
      const cont = await run(svc, { kind: 'continueOperation' });
      expect(cont.ok).toBe(true);
      expect((await getStatus(repo)).operation).toBeUndefined();
      expect(subjects(repo, 1)).toEqual(['f3']);
    },
    T,
  );

  it(
    'atla: commit alınmaz, işlem biter',
    async () => {
      const { repo, f3 } = await setup();
      const { svc } = service(repo);
      const before = git(repo, 'rev-parse', 'HEAD');

      await run(svc, { kind: 'cherryPick', hashes: [f3] });
      const skip = await run(svc, { kind: 'skipOperation' });

      expect(skip.ok).toBe(true);
      expect(skip.commands).toEqual(['git cherry-pick --skip']);
      expect((await getStatus(repo)).operation).toBeUndefined();
      expect(git(repo, 'rev-parse', 'HEAD')).toBe(before); // atlanan commit alınmadı
    },
    T,
  );

  it(
    'iptal et (onaylı): çakışmadan önceki duruma dönülür',
    async () => {
      const { repo, f3 } = await setup();
      const { svc } = service(repo, { ui: new FakeUi([true]) });
      const before = git(repo, 'rev-parse', 'HEAD');

      await run(svc, { kind: 'cherryPick', hashes: [f3] });
      const abort = await run(svc, { kind: 'abortOperation' });

      expect(abort.ok).toBe(true);
      expect((await getStatus(repo)).operation).toBeUndefined();
      expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
      expect(git(repo, 'show', 'HEAD:a.txt')).toContain('MAIN');
    },
    T,
  );

  it(
    'çoklu cherry-pick ortada çakışırsa önceki commit korunur, atlayınca kalanı sürer',
    async () => {
      const { repo, f1, f3 } = await setup();
      const { svc } = service(repo, { ui: new FakeUi([true]) });

      // f1 temiz, f3 çakışır
      const r = await run(svc, { kind: 'cherryPick', hashes: [f1, f3] });
      expect(r.ok).toBe(false);
      expect((await getStatus(repo)).operation).toBe('cherryPick');
      // f1 zaten alınmış durumda
      expect(subjects(repo, 1)).toEqual(['f1']);

      expect((await run(svc, { kind: 'skipOperation' })).ok).toBe(true);
      expect((await getStatus(repo)).operation).toBeUndefined();
      expect(subjects(repo, 1)).toEqual(['f1']);
    },
    T,
  );

  it(
    'işlem yokken ve merge sırasında atlanamaz',
    async () => {
      const { repo } = await setup();
      const { svc } = service(repo);

      expect((await run(svc, { kind: 'skipOperation' })).ok).toBe(false);

      // merge çakışması kur: feature'ı main'e birleştir
      let merged = true;
      try {
        git(repo, 'merge', '--no-edit', 'feature');
      } catch {
        merged = false;
      }
      expect(merged).toBe(false);
      expect((await getStatus(repo)).operation).toBe('merge');

      const r = await run(svc, { kind: 'skipOperation' });
      expect(r.ok).toBe(false);
      expect(r.commands).toEqual([]); // merge'de --skip yok, komut çalıştırılmaz
    },
    T,
  );
});

describe('F5 geri bildirimi: boş commit ve bisect çakışması', () => {
  it(
    'değişiklikleri zaten branch\'te olan commit: ham git çıktısı değil, "Atla" yönlendirmesi',
    async () => {
      const { repo, f3 } = await setup();
      const { svc } = service(repo);

      // f3'ün değişikliğini main'de birebir uygula → cherry-pick boş kalır
      await write(repo, 'a.txt', 'FEATURE\niki\nüç\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'main de ayni degisikligi yapti');

      const r = await run(svc, { kind: 'cherryPick', hashes: [f3] });
      expect(r.ok).toBe(false);
      expect(r.message).toContain('Atla');
      expect(r.message).not.toContain('allow-empty'); // ham git çıktısı sızmasın
      // git bu durumda işlemi açık bırakır; bant görünür ve Atla gerçekten çalışır
      expect((await getStatus(repo)).operation).toBe('cherryPick');
      const skip = await run(svc, { kind: 'skipOperation' });
      expect(skip.ok).toBe(true);
      expect((await getStatus(repo)).operation).toBeUndefined();
    },
    T,
  );

  it(
    'bisect sürerken commit alınamaz',
    async () => {
      const { repo, f1 } = await setup();
      const { svc } = service(repo);
      git(repo, 'bisect', 'start');
      git(repo, 'bisect', 'bad');

      const r = await run(svc, { kind: 'cherryPick', hashes: [f1] });
      expect(r.ok).toBe(false);
      expect(r.message).toContain('Bisect');
      expect(r.commands).toEqual([]); // komut hiç çalışmadı
      git(repo, 'bisect', 'reset');
      expect((await run(svc, { kind: 'cherryPick', hashes: [f1] })).ok).toBe(true);
    },
    T,
  );

  it(
    'süren bir cherry-pick varken bisect başlatılamaz',
    async () => {
      const { repo, f3 } = await setup();
      const { svc } = service(repo);
      await run(svc, { kind: 'cherryPick', hashes: [f3] });
      expect((await getStatus(repo)).operation).toBe('cherryPick');

      const r = await run(svc, { kind: 'bisectStart', bad: 'HEAD', good: 'HEAD~1' });
      expect(r.ok).toBe(false);
      expect(r.commands).toEqual([]);
    },
    T,
  );
});
