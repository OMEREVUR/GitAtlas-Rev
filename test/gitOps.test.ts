import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { OpQueue } from '../src/ops/opQueue';
import { GitOpsService, type OpsDeps, type OpsUi } from '../src/ops/gitOpsService';
import type { GitOpRequest, OpResult } from '../src/types';

const T = 60_000;
const temps: string[] = [];

afterAll(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function configure(repo: string): void {
  git(repo, 'config', 'user.name', 'Test Kisi');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', '.git/hooks');
}

async function write(repo: string, path: string, text: string): Promise<void> {
  await writeFile(join(repo, path), text, 'utf8');
}

/** Bare origin + main'i gönderilmiş bir çalışma reposu + gerekirse ikinci klon. */
async function setup(): Promise<{ dir: string; repo: string; origin: string; clone: () => string }> {
  const dir = await mkdtemp(join(tmpdir(), 'rewiewrev-ops-'));
  temps.push(dir);
  const origin = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-q', '-b', 'main', repo);
  configure(repo);
  await write(repo, 'a.txt', 'bir\niki\nüç\n');
  await write(repo, 'b.txt', 'b\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'ilk');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  let n = 0;
  const clone = (): string => {
    const other = join(dir, `other${n++}`);
    git(dir, 'clone', '-q', origin, other);
    configure(other);
    return other;
  };
  return { dir, repo, origin, clone };
}

class FakeUi implements OpsUi {
  readonly asked: string[] = [];
  constructor(
    private readonly confirms: boolean[] = [],
    private readonly picks: (string | undefined)[] = [],
  ) {}
  confirm(message: string, detail: string, action: string): Promise<boolean> {
    this.asked.push(`confirm:${message}|${detail}|${action}`);
    return Promise.resolve(this.confirms.shift() ?? false);
  }
  pick<T extends string>(title: string, items: { id: T; label: string }[]): Promise<T | undefined> {
    this.asked.push(`pick:${title}|${items.map((i) => i.label).join('/')}`);
    const id = this.picks.shift();
    return Promise.resolve(items.find((i) => i.id === id)?.id);
  }
}

function service(repo: string, opts: Partial<OpsDeps> & { ui?: OpsUi } = {}): { svc: GitOpsService; log: string[]; ui: FakeUi } {
  const log: string[] = [];
  const ui = (opts.ui as FakeUi | undefined) ?? new FakeUi();
  const svc = new GitOpsService({
    root: repo,
    ui,
    pullStrategy: () => 'ask',
    log: (l) => log.push(l),
    ...opts,
  });
  return { svc, log, ui };
}

let seq = 0;
const run = (svc: GitOpsService, op: GitOpRequest): Promise<OpResult> => svc.run(`op${++seq}`, op);

describe('OpQueue', () => {
  it('işler sırayla çalışır; hata kuyruğu durdurmaz; busy bildirilir', async () => {
    const q = new OpQueue();
    const events: string[] = [];
    const busy: boolean[] = [];
    q.onDidChangeBusy((b) => busy.push(b));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = q.run(async () => {
      events.push('a-başla');
      await gate;
      events.push('a-bitti');
      return 'a';
    });
    const b = q.run(async () => {
      events.push('b');
      throw new Error('b hatası');
    });
    const c = q.run(async () => {
      events.push('c');
      return 'c';
    });
    expect(q.busy).toBe(true);
    await Promise.resolve();
    expect(events).toEqual(['a-başla']);
    release();
    expect(await a).toBe('a');
    await expect(b).rejects.toThrow('b hatası');
    expect(await c).toBe('c');
    expect(events).toEqual(['a-başla', 'a-bitti', 'b', 'c']);
    await Promise.resolve();
    expect(q.busy).toBe(false);
    expect(busy).toEqual([true, false]);
  });
});

describe('GitOpsService', () => {
  it('stage / unstage / stageAll / unstageAll', async () => {
    const { repo } = await setup();
    const { svc } = service(repo);
    await write(repo, 'a.txt', 'değişti\n');
    await write(repo, 'yeni.txt', 'yeni\n');

    const started: string[][] = [];
    const r1 = await svc.run('x', { kind: 'stage', paths: ['a.txt'] }, (c) => started.push(c));
    expect(r1).toMatchObject({ id: 'x', kind: 'stage', ok: true, message: "1 dosya commit'e eklendi.", commands: ['git add -- a.txt'] });
    expect(started).toEqual([['git add -- a.txt']]);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('a.txt');

    expect((await run(svc, { kind: 'unstage', paths: ['a.txt'] })).message).toBe("1 dosya commit'ten çıkarıldı.");
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');

    expect((await run(svc, { kind: 'stageAll' })).message).toBe("2 dosya commit'e eklendi.");
    expect(git(repo, 'diff', '--cached', '--name-only').split('\n').sort()).toEqual(['a.txt', 'yeni.txt']);
    expect((await run(svc, { kind: 'unstageAll' })).message).toBe("2 dosya commit'ten çıkarıldı.");
    expect((await run(svc, { kind: 'stage', paths: [] })).ok).toBe(false);
  }, T);

  it('discard: onay hayır → dokunulmaz; evet → geri alınır ve untracked silinir', async () => {
    const { repo } = await setup();
    await write(repo, 'a.txt', 'değişti\n');
    await write(repo, 'yeni.txt', 'yeni\n');
    const no = service(repo, { ui: new FakeUi([false]) });
    const r0 = await run(no.svc, { kind: 'discard', paths: ['a.txt', 'yeni.txt'] });
    expect(r0).toMatchObject({ ok: false, cancelled: true, message: 'İptal edildi.', commands: [] });
    expect(no.ui.asked[0]).toContain('2 dosyadaki değişiklik kalıcı olarak silinecek');
    expect(no.ui.asked[0]).toContain('untracked');
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('değişti\n');

    const yes = service(repo, { ui: new FakeUi([true]) });
    const r1 = await run(yes.svc, { kind: 'discard', paths: ['a.txt', 'yeni.txt'] });
    expect(r1.ok).toBe(true);
    expect(r1.commands).toEqual(['git restore --worktree -- a.txt', 'git clean -f -- yeni.txt']);
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('bir\niki\nüç\n');
    expect(existsSync(join(repo, 'yeni.txt'))).toBe(false);
  }, T);

  it('commit: boş mesaj, staged yok, normal, amend (gönderilmişse onaylı)', async () => {
    const { repo } = await setup();
    const { svc, ui } = service(repo, { ui: new FakeUi([false, true]) });
    expect(await run(svc, { kind: 'commit', message: '  ', amend: false, push: false })).toMatchObject({
      ok: false,
      message: 'Commit mesajı boş olamaz.',
      commands: [],
    });
    expect((await run(svc, { kind: 'commit', message: 'x', amend: false, push: false })).message).toBe(
      "Commit'e eklenmiş dosya yok — önce dosya seçin.",
    );

    await write(repo, 'a.txt', 'değişti\n');
    git(repo, 'add', 'a.txt');
    const r = await run(svc, { kind: 'commit', message: 'feat: değişiklik\n\nayrıntı', amend: false, push: false });
    const short = git(repo, 'log', '-1', '--format=%h');
    expect(r).toMatchObject({ ok: true, message: `Commit oluşturuldu: ${short} feat: değişiklik.` });
    expect(git(repo, 'log', '-1', '--format=%b')).toBe('ayrıntı');

    // Gönderilmemiş commit: amend onaysız
    const r2 = await run(svc, { kind: 'commit', message: 'feat: düzeltildi', amend: true, push: false });
    expect(r2.ok).toBe(true);
    expect(r2.message).toMatch(/^Son commit değiştirildi: [0-9a-f]+ feat: düzeltildi\.$/);
    expect(ui.asked).toHaveLength(0);

    // Gönderilmiş commit: amend onaylı (önce hayır, sonra evet)
    git(repo, 'push', '-q');
    const r3 = await run(svc, { kind: 'commit', message: 'feat: yeniden', amend: true, push: false });
    expect(r3).toMatchObject({ ok: false, cancelled: true });
    expect(ui.asked[0]).toContain('zaten gönderildi');
    const r4 = await run(svc, { kind: 'commit', message: '', amend: true, push: false });
    expect(r4.ok).toBe(true);
    expect(r4.commands[0]).toBe('git commit --no-edit --amend');
  }, T);

  it('pre-commit hook başarısızsa --no-verify yok; mesaj + hook çıktısı', async () => {
    const { repo } = await setup();
    await writeFile(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "lint hatası: a.txt" >&2\nexit 1\n', { mode: 0o755 });
    await write(repo, 'a.txt', 'değişti\n');
    git(repo, 'add', 'a.txt');
    const { svc } = service(repo);
    const r = await run(svc, { kind: 'commit', message: 'feat: x', amend: false, push: false });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("pre-commit hook'u commit'i durdurdu.");
    expect(r.detail).toContain('lint hatası: a.txt');
    expect(r.commands.join(' ')).not.toContain('--no-verify');
  }, T);

  it('undoLastCommit: gönderilmişse onaylı; değişiklikler index\'te kalır', async () => {
    const { repo } = await setup();
    const { svc, ui } = service(repo, { ui: new FakeUi([false, true]) });
    const cancelledResult = await run(svc, { kind: 'undoLastCommit' });
    expect(cancelledResult).toMatchObject({ ok: false, cancelled: true });
    expect(ui.asked[0]).toContain('Bu commit zaten gönderildi; geri almak geçmişi değiştirir.');

    await write(repo, 'c.txt', 'c\n');
    git(repo, 'add', 'c.txt');
    git(repo, 'commit', '-q', '-m', 'yerel');
    const r = await run(svc, { kind: 'undoLastCommit' }); // gönderilmemiş: onay yok
    expect(r).toMatchObject({ ok: true, commands: ['git reset --soft HEAD~1'] });
    expect(r.message).toContain('Son commit geri alındı');
    expect(ui.asked).toHaveLength(1);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('c.txt');
  }, T);

  it('fetch ve fast-forward pull', async () => {
    const { repo, clone } = await setup();
    const other = clone();
    await write(other, 'b.txt', 'uzaktan\n');
    git(other, 'commit', '-q', '-am', 'uzak');
    git(other, 'push', '-q');

    const { svc } = service(repo);
    const f = await run(svc, { kind: 'fetch' });
    expect(f).toMatchObject({ ok: true, commands: ['git fetch --prune'] });
    expect(f.message).toContain('origin/main 1 commit ileride');

    const p = await run(svc, { kind: 'pull' });
    expect(p).toMatchObject({ ok: true, message: '1 commit çekildi.', commands: ['git pull --ff-only'] });
    expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('uzaktan\n');
    expect((await run(svc, { kind: 'pull' })).message).toBe('Zaten güncel.');
  }, T);

  async function diverge(): Promise<{ repo: string; clone: () => string }> {
    const s = await setup();
    const other = s.clone();
    await write(other, 'b.txt', 'uzaktan\n');
    git(other, 'commit', '-q', '-am', 'uzak');
    git(other, 'push', '-q');
    await write(s.repo, 'c.txt', 'yerel\n');
    git(s.repo, 'add', 'c.txt');
    git(s.repo, 'commit', '-q', '-m', 'yerel');
    return s;
  }

  it('ayrışmış pull → pick rebase', async () => {
    const { repo } = await diverge();
    const ui = new FakeUi([], ['rebase']);
    const { svc } = service(repo, { ui });
    const r = await run(svc, { kind: 'pull' });
    expect(r.ok).toBe(true);
    expect(r.commands).toEqual(['git pull --ff-only', 'git pull --rebase']);
    expect(ui.asked[0]).toMatch(/^pick:.*ayrışmış.*\|Merge\/Rebase\/İptal$/);
    expect(r.message).toBe("Rebase yapıldı: yerel commit'ler origin/main üstüne taşındı.");
    expect(git(repo, 'rev-list', '--merges', '--count', 'HEAD')).toBe('0');
    expect(git(repo, 'log', '--format=%s', '-2')).toBe('yerel\nuzak');
  }, T);

  it('ayrışmış pull → pick merge; ayar "merge" ise sorulmaz; iptal edilebilir', async () => {
    const a = await diverge();
    const ui = new FakeUi([], ['merge']);
    const r = await run(service(a.repo, { ui }).svc, { kind: 'pull' });
    expect(r.ok).toBe(true);
    expect(r.commands[1]).toBe('git pull --no-rebase');
    expect(r.message).toBe('Birleştirildi (merge): origin/main → main.');
    expect(git(a.repo, 'rev-list', '--merges', '--count', 'HEAD')).toBe('1');

    const b = await diverge();
    const ui2 = new FakeUi();
    const r2 = await run(service(b.repo, { ui: ui2, pullStrategy: () => 'merge' }).svc, { kind: 'pull' });
    expect(r2.ok).toBe(true);
    expect(ui2.asked).toHaveLength(0);

    const c = await diverge();
    const r3 = await run(service(c.repo, { ui: new FakeUi([], ['cancel']) }).svc, { kind: 'pull' });
    expect(r3).toMatchObject({
      ok: false,
      cancelled: true,
      message: 'Pull yapılamadı: yerel ve uzak branch ayrışmış. Merge ya da rebase seçin.',
    });
  }, T);

  it('pull çakışması → mesaj; abortOperation (onaylı) ile geri dönülür', async () => {
    const { repo, clone } = await setup();
    const other = clone();
    await write(other, 'a.txt', 'uzak satır\n');
    git(other, 'commit', '-q', '-am', 'uzak');
    git(other, 'push', '-q');
    await write(repo, 'a.txt', 'yerel satır\n');
    git(repo, 'commit', '-q', '-am', 'yerel');
    const before = git(repo, 'rev-parse', 'HEAD');

    const ui = new FakeUi([true], []);
    const { svc } = service(repo, { ui, pullStrategy: () => 'merge' });
    const r = await run(svc, { kind: 'pull' });
    expect(r).toMatchObject({ ok: false, message: "Çakışma var: dosyaları çözüp 'Çözüldü' deyin ya da işlemi iptal edin." });
    expect(r.detail).toContain('CONFLICT');

    const a = await run(svc, { kind: 'abortOperation' });
    expect(a).toMatchObject({ ok: true, message: 'Merge iptal edildi; önceki duruma dönüldü.', commands: ['git merge --abort'] });
    expect(ui.asked[0]).toContain('İşlemi iptal et');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect((await run(svc, { kind: 'abortOperation' })).message).toBe('İptal edilecek bir işlem yok.');
  }, T);

  it('çakışma çözülüp markResolved + continueOperation', async () => {
    const { repo } = await setup();
    git(repo, 'switch', '-q', '-c', 'yan');
    await write(repo, 'a.txt', 'yan\n');
    git(repo, 'commit', '-q', '-am', 'yan');
    git(repo, 'switch', '-q', 'main');
    await write(repo, 'a.txt', 'ana\n');
    git(repo, 'commit', '-q', '-am', 'ana');
    const { svc } = service(repo);
    const m = await run(svc, { kind: 'mergeBranch', branch: 'yan' });
    expect(m.ok).toBe(false);
    expect(m.message).toContain('Çakışma var');
    await write(repo, 'a.txt', 'çözüldü\n');
    expect((await run(svc, { kind: 'markResolved', paths: ['a.txt'] })).message).toBe('1 dosya çözüldü olarak işaretlendi.');
    const c = await run(svc, { kind: 'continueOperation' });
    expect(c).toMatchObject({ ok: true, message: 'Merge tamamlandı.', commands: ['git commit --no-edit'] });
    expect(git(repo, 'rev-list', '--merges', '--count', 'HEAD')).toBe('1');
  }, T);

  it('push: upstream\'siz yeni branch → -u origin; sonra reddedilen push', async () => {
    const { repo, clone } = await setup();
    git(repo, 'switch', '-q', '-c', 'feature');
    await write(repo, 'c.txt', 'c\n');
    git(repo, 'add', 'c.txt');
    git(repo, 'commit', '-q', '-m', 'feature');
    const { svc } = service(repo);
    const r = await run(svc, { kind: 'push' });
    expect(r).toMatchObject({
      ok: true,
      commands: ['git push -u origin feature'],
      message: 'Gönderildi → origin/feature (1 commit); takip ayarlandı.',
    });
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/feature');
    expect((await run(svc, { kind: 'push' })).message).toBe('Gönderilecek commit yok; origin/feature güncel.');

    git(repo, 'switch', '-q', 'main');
    const other = clone();
    await write(other, 'b.txt', 'uzak\n');
    git(other, 'commit', '-q', '-am', 'uzak');
    git(other, 'push', '-q');
    await write(repo, 'a.txt', 'yerel\n');
    git(repo, 'commit', '-q', '-am', 'yerel');
    const rej = await run(svc, { kind: 'push' });
    expect(rej).toMatchObject({ ok: false, message: "Uzakta yeni commit'ler var; önce Çek (pull) yapın." });
  }, T);

  it('push force onaylı (--force-with-lease)', async () => {
    const { repo } = await setup();
    await write(repo, 'a.txt', 'x\n');
    git(repo, 'commit', '-q', '-am', 'x');
    git(repo, 'push', '-q');
    git(repo, 'commit', '-q', '--amend', '-m', 'x2');
    const ui = new FakeUi([false, true]);
    const { svc } = service(repo, { ui });
    expect(await run(svc, { kind: 'push', force: true })).toMatchObject({ ok: false, cancelled: true, commands: [] });
    const r = await run(svc, { kind: 'push', force: true });
    expect(r).toMatchObject({ ok: true, commands: ['git push --force-with-lease'] });
    expect(r.message).toBe('Zorla gönderildi → origin/main (1 commit).');
  }, T);

  it('checkout kirli ağaçla → sakla (stash) ve geç; iptal edilebilir', async () => {
    const { repo } = await setup();
    git(repo, 'switch', '-q', '-c', 'diger');
    await write(repo, 'a.txt', 'diğer\n');
    git(repo, 'commit', '-q', '-am', 'diğer');
    git(repo, 'switch', '-q', 'main');
    await write(repo, 'a.txt', 'kirli\n');

    const cancel = service(repo, { ui: new FakeUi([], ['cancel']) });
    expect(await run(cancel.svc, { kind: 'checkout', branch: 'diger' })).toMatchObject({ ok: false, cancelled: true });
    expect(git(repo, 'branch', '--show-current')).toBe('main');

    const ui = new FakeUi([], ['stash']);
    const { svc } = service(repo, { ui });
    const r = await run(svc, { kind: 'checkout', branch: 'diger' });
    expect(r.ok).toBe(true);
    expect(r.commands).toEqual(['git switch diger', 'git stash push -u -m "RewiewRev: diger geçişinden önce"', 'git switch diger']);
    expect(r.message).toBe('Geçildi: diger. Değişiklikleriniz saklandı (stash@{0}).');
    expect(ui.asked[0]).toContain('Değişiklikleri sakla (stash) ve geç/İptal');
    expect(git(repo, 'branch', '--show-current')).toBe('diger');
    expect(git(repo, 'stash', 'list', '--format=%gs')).toBe('On main: RewiewRev: diger geçişinden önce');
    expect((await run(svc, { kind: 'checkout', branch: 'diger' })).message).toBe("Zaten bu branch'tesiniz: diger.");
  }, T);

  it('createBranch / renameBranch / mergeBranch', async () => {
    const { repo } = await setup();
    const { svc } = service(repo);
    const bad = await run(svc, { kind: 'createBranch', name: 'kötü ad', checkout: true });
    expect(bad).toMatchObject({ ok: false, commands: [] });
    expect(bad.message).toContain('Geçersiz branch adı');
    expect((await run(svc, { kind: 'renameBranch', from: 'main', to: 'a..b' })).ok).toBe(false);

    expect((await run(svc, { kind: 'createBranch', name: 'feature/x', checkout: true })).message).toBe(
      'Branch oluşturuldu ve geçildi: feature/x.',
    );
    expect((await run(svc, { kind: 'createBranch', name: 'feature/x', checkout: false })).message).toBe(
      '"feature/x" adında bir branch zaten var.',
    );
    await write(repo, 'c.txt', 'c\n');
    git(repo, 'add', 'c.txt');
    git(repo, 'commit', '-q', '-m', 'c');
    git(repo, 'switch', '-q', 'main');

    const ren = await run(svc, { kind: 'renameBranch', from: 'feature/x', to: 'feature/y' });
    expect(ren).toMatchObject({
      ok: true,
      commands: ['git branch -m feature/x feature/y'],
      message: 'Branch adı değiştirildi: feature/x → feature/y.',
    });

    const m = await run(svc, { kind: 'mergeBranch', branch: 'feature/y' });
    expect(m).toMatchObject({ ok: true, message: 'Birleştirildi: feature/y → main.', commands: ['git merge --no-edit feature/y'] });
    expect(existsSync(join(repo, 'c.txt'))).toBe(true);
    expect((await run(svc, { kind: 'mergeBranch', branch: 'feature/y' })).message).toContain('Zaten güncel');
  }, T);

  it('deleteBranch: birleşmemişse iki onay; mevcut branch silinemez', async () => {
    const { repo } = await setup();
    git(repo, 'switch', '-q', '-c', 'yan');
    await write(repo, 'c.txt', 'c\n');
    git(repo, 'add', 'c.txt');
    git(repo, 'commit', '-q', '-m', 'yan');
    const cur = service(repo);
    expect((await run(cur.svc, { kind: 'deleteBranch', name: 'yan' })).ok).toBe(false);
    git(repo, 'switch', '-q', 'main');

    const half = service(repo, { ui: new FakeUi([true, false]) });
    const r0 = await run(half.svc, { kind: 'deleteBranch', name: 'yan' });
    expect(r0).toMatchObject({ ok: false, cancelled: true });
    expect(half.ui.asked).toHaveLength(2);
    expect(half.ui.asked[1]).toContain('birleştirilmemiş');
    expect(git(repo, 'branch', '--list', 'yan')).toContain('yan');

    const full = service(repo, { ui: new FakeUi([true, true]) });
    const r = await run(full.svc, { kind: 'deleteBranch', name: 'yan' });
    expect(r).toMatchObject({ ok: true, message: 'Branch silindi: yan.', commands: ['git branch -d yan', 'git branch -D yan'] });
    expect(git(repo, 'branch', '--list', 'yan')).toBe('');

    git(repo, 'branch', 'birlesmis');
    const merged = service(repo, { ui: new FakeUi([true]) });
    expect(await run(merged.svc, { kind: 'deleteBranch', name: 'birlesmis' })).toMatchObject({ ok: true, commands: ['git branch -d birlesmis'] });
  }, T);

  it('stash save / apply / pop / drop', async () => {
    const { repo } = await setup();
    const ui = new FakeUi([false, true]);
    const { svc } = service(repo, { ui });
    expect((await run(svc, { kind: 'stashSave', includeUntracked: true })).ok).toBe(false);

    await write(repo, 'a.txt', 'kirli\n');
    await write(repo, 'yeni.txt', 'yeni\n');
    const s = await run(svc, { kind: 'stashSave', message: 'yarım iş', includeUntracked: true });
    expect(s).toMatchObject({ ok: true, commands: ['git stash push -u -m "yarım iş"'], message: 'Değişiklikler saklandı (stash@{0}).' });
    expect(existsSync(join(repo, 'yeni.txt'))).toBe(false);

    const a = await run(svc, { kind: 'stashApply', index: 0, pop: false });
    expect(a).toMatchObject({ ok: true, message: 'stash@{0} uygulandı.' });
    expect(git(repo, 'stash', 'list')).not.toBe('');
    git(repo, 'reset', '-q', '--hard');
    git(repo, 'clean', '-qfd');

    const d0 = await run(svc, { kind: 'stashDrop', index: 0 });
    expect(d0).toMatchObject({ ok: false, cancelled: true });
    expect(ui.asked[0]).toContain('stash@{0} kalıcı olarak silinecek.|yarım iş|Sil');

    const p = await run(svc, { kind: 'stashApply', index: 0, pop: true });
    expect(p).toMatchObject({ ok: true, message: 'stash@{0} uygulandı ve listeden kaldırıldı.' });
    expect(git(repo, 'stash', 'list')).toBe('');
    expect(await readFile(join(repo, 'yeni.txt'), 'utf8')).toBe('yeni\n');

    git(repo, 'stash', 'push', '-q', '-u', '-m', 'ikinci');
    const d = await run(svc, { kind: 'stashDrop', index: 0 });
    expect(d).toMatchObject({ ok: true, message: 'stash@{0} silindi.' });
    expect(git(repo, 'stash', 'list')).toBe('');
  }, T);

  it('kuyruk: aynı anda gönderilen işlemler sırayla çalışır', async () => {
    const { repo } = await setup();
    await write(repo, 'a.txt', 'değişti\n');
    const { svc, log } = service(repo);
    const results = await Promise.all([
      run(svc, { kind: 'stage', paths: ['a.txt'] }),
      run(svc, { kind: 'commit', message: 'sıralı', amend: false, push: false }),
      run(svc, { kind: 'undoLastCommit' }),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(log.filter((l) => l.startsWith('$ ')).map((l) => l.split(' ')[2])).toEqual(['add', 'commit', 'reset']);
  }, T);

  it('kimlik yedeği: auth hatasında token ile bir kez yeniden dener; token log\'a yazılmaz', async () => {
    const { repo, origin } = await setup();
    // Uzak taraf: RR_ASKPASS_TOKEN yoksa "Authentication failed" ile reddeder (yerel taşımada ortam aktarılır).
    const hook = join(origin, 'hooks', 'pre-receive');
    await writeFile(hook, '#!/bin/sh\nif [ -z "$RR_ASKPASS_TOKEN" ]; then echo "fatal: Authentication failed for origin" >&2; exit 1; fi\n', {
      mode: 0o755,
    });
    git(origin, 'config', 'core.hooksPath', join(origin, 'hooks').replace(/\\/g, '/'));
    await write(repo, 'a.txt', 'x\n');
    git(repo, 'commit', '-q', '-am', 'x');

    const noToken = service(repo);
    expect((await run(noToken.svc, { kind: 'push' })).message).toBe(
      "Kimlik doğrulama başarısız. Git kimlik bilgilerinizi ayarlayın ya da RewiewRev'de GitHub'a bağlanın.",
    );

    const getToken = vi.fn(() => Promise.resolve<string | undefined>('gizli-token-123'));
    const withToken = service(repo, { getToken });
    const r = await run(withToken.svc, { kind: 'push' });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, commands: ['git push'] });
    expect(withToken.log).toContain('GitHub oturumuyla yeniden deneniyor…');
    expect(withToken.log.join('\n')).not.toContain('gizli-token-123');
    expect(r.detail ?? '').not.toContain('gizli-token-123');
    expect(git(origin, 'log', '-1', '--format=%s', 'main')).toBe('x');
  }, T);
});

// ---- make-fixture.sh ile: commit + push fixture'ın origin'ine ----

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

describe.skipIf(!bash)('GitOpsService (fixture reposu)', () => {
  it('commit + push: commit sonrası origin/main\'e gönderilir (↑2 + yeni commit)', async () => {
    const repo = execFileSync(bash!, [resolve(__dirname, '..', 'scripts', 'make-fixture.sh')], { encoding: 'utf8' }).trim();
    temps.push(repo);
    git(repo, 'config', 'core.hooksPath', '.git/hooks');
    await write(repo, 'README.md', '# Fixture\nyeni satır\n');
    const { svc } = service(repo);
    expect((await run(svc, { kind: 'stage', paths: ['README.md'] })).ok).toBe(true);
    const started: string[][] = [];
    const r = await svc.run('cp', { kind: 'commit', message: 'docs: readme', amend: false, push: true }, (c) => started.push(c));
    expect(r.ok).toBe(true);
    expect(started).toEqual([['git commit -m "docs: readme"', 'git push']]);
    expect(r.commands).toEqual(['git commit -m "docs: readme"', 'git push']);
    expect(r.message).toMatch(/^Commit oluşturuldu: [0-9a-f]+ docs: readme\. Gönderildi → origin\/main \(3 commit\)\.$/);
    expect(git(repo, 'rev-parse', 'origin/main')).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(git(repo, 'rev-list', '--count', 'main')).toBe('35');
  }, T);
});
