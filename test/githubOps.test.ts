import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitHubOpsService } from '../src/ops/githubOpsService';
import { GitOpsService, type OpsUi } from '../src/ops/gitOpsService';
import { OpQueue } from '../src/ops/opQueue';
import type { PullRequestDetail } from '../src/types';

const T = 60_000;
const TOKEN = 'gizli-token-xyz';

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
const temps: string[] = [];
afterAll(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(): string {
  const repo = execFileSync(bash!, [resolve(__dirname, '..', 'scripts', 'make-fixture.sh')], { encoding: 'utf8' }).trim();
  temps.push(repo);
  git(repo, 'config', 'core.hooksPath', '.git/hooks');
  return repo;
}

const originOf = (repo: string): string => git(repo, 'remote', 'get-url', 'origin');
const originHas = (repo: string, ref: string): boolean => {
  try {
    git(repo, 'ls-remote', '--exit-code', 'origin', ref);
    return true;
  } catch {
    return false;
  }
};

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

interface Call {
  method: string;
  url: string;
  body: unknown;
  auth: string;
}

/** Sahte GitHub REST API: istekleri kaydeder, verilen yanıtları sırayla döner. */
function fakeFetch(responses: { status: number; json?: unknown }[]): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      auth: headers.get('Authorization') ?? '',
    });
    const r = responses.shift() ?? { status: 500 };
    const body = r.json === undefined ? null : JSON.stringify(r.json);
    return Promise.resolve(new Response(r.status === 204 ? null : body, { status: r.status, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

function pr(over: Partial<PullRequestDetail> & { number: number; headRef: string }): PullRequestDetail {
  return {
    title: `PR ${over.number}`,
    url: `https://github.com/o/r/pull/${over.number}`,
    author: 'ayse',
    baseRef: 'main',
    isDraft: false,
    updatedAt: 0,
    files: [],
    ci: 'none',
    body: '',
    mergeable: 'mergeable',
    reviewDecision: 'none',
    reviewRequested: false,
    isCrossRepository: false,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    checks: [],
    ...over,
  };
}

function services(
  repo: string,
  opts: { ui?: FakeUi; responses?: { status: number; json?: unknown }[]; prs?: PullRequestDetail[]; token?: string | null } = {},
) {
  const queue = new OpQueue();
  const ui = opts.ui ?? new FakeUi();
  const log: string[] = [];
  const getToken = (): Promise<string | undefined> => Promise.resolve(opts.token === null ? undefined : (opts.token ?? TOKEN));
  const gitOps = new GitOpsService({ root: repo, ui, getToken, pullStrategy: () => 'ask', log: (l) => log.push(l) }, queue);
  const { fetchFn, calls } = fakeFetch(opts.responses ?? []);
  const prs = opts.prs ?? [];
  const gh = new GitHubOpsService({
    root: repo,
    ui,
    gitOps,
    queue,
    coords: () => ({ owner: 'o', repo: 'r' }),
    getToken,
    fetchFn,
    log: (l) => log.push(l),
    getPr: (n) => prs.find((p) => p.number === n),
    defaultBranch: () => 'main',
  });
  return { gh, gitOps, queue, ui, log, calls };
}

describe.skipIf(!bash)('GitHubOpsService (fixture + sahte GitHub API)', () => {
  it('bağlı değilse hata; token yoksa da', async () => {
    const repo = fixture();
    const { gh, calls } = services(repo, { token: null });
    const r = await gh.run('a', { kind: 'createPr', title: 'x', body: '', base: 'main', draft: false });
    expect(r).toMatchObject({ id: 'a', kind: 'createPr', ok: false, message: "GitHub'a bağlı değil — önce bağlanın.", commands: [] });
    expect(calls).toHaveLength(0);
  }, T);

  it('createPr: gönderilmemiş branch → onay hayır (iptal) / evet (push + API)', async () => {
    const repo = fixture();
    git(repo, 'switch', '-q', 'feature/graph');

    const no = services(repo, { ui: new FakeUi([false]) });
    const r0 = await no.gh.run('a', { kind: 'createPr', title: 'Graph', body: 'b', base: 'main', draft: false });
    expect(r0).toMatchObject({ ok: false, cancelled: true, message: 'İptal edildi.', commands: [] });
    expect(no.ui.asked[0]).toBe('confirm:PR açmadan önce branch gönderilsin mi?|git push -u origin feature/graph|Gönder ve PR aç');
    expect(no.calls).toHaveLength(0);
    expect(originHas(repo, 'refs/heads/feature/graph')).toBe(false);

    const yes = services(repo, {
      ui: new FakeUi([true]),
      responses: [{ status: 201, json: { number: 12, html_url: 'https://github.com/o/r/pull/12' } }],
    });
    const started: string[][] = [];
    const r = await yes.gh.run('b', { kind: 'createPr', title: 'Graph', body: 'açıklama', base: 'main', draft: false }, (c) => started.push(c));
    expect(r).toMatchObject({
      ok: true,
      message: 'PR açıldı: #12 Graph',
      commands: ['git push -u origin feature/graph', 'GitHub: PR oluştur (feature/graph → main)'],
    });
    expect(started).toEqual([['git push -u origin feature/graph', 'GitHub: PR oluştur (feature/graph → main)']]);
    expect(r.detail).toContain('https://github.com/o/r/pull/12');
    expect(originHas(repo, 'refs/heads/feature/graph')).toBe(true);
    expect(yes.calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.github.com/repos/o/r/pulls',
        body: { title: 'Graph', body: 'açıklama', head: 'feature/graph', base: 'main', draft: false },
        auth: `Bearer ${TOKEN}`,
      },
    ]);
    // Token hiçbir çıktıda yok
    expect([...r.commands, r.detail ?? '', r.message, ...yes.log].join('\n')).not.toContain(TOKEN);

    // Artık gönderilmiş: onay sorulmadan doğrudan API (taslak)
    const again = services(repo, { responses: [{ status: 201, json: { number: 13, html_url: 'https://github.com/o/r/pull/13' } }] });
    const r2 = await again.gh.run('c', { kind: 'createPr', title: 'Graph 2', body: '', base: 'main', draft: true });
    expect(r2).toMatchObject({ ok: true, message: 'Taslak PR açıldı: #13 Graph 2', commands: ['GitHub: PR oluştur (feature/graph → main)'] });
    expect(again.ui.asked).toHaveLength(0);
  }, T);

  it('createPr: ayrık HEAD, boş başlık, API hatası (401 / zaten var)', async () => {
    const repo = fixture();
    git(repo, 'switch', '-q', '--detach');
    const d = services(repo);
    expect((await d.gh.run('a', { kind: 'createPr', title: 'x', body: '', base: 'main', draft: false })).message).toBe(
      "PR açmak için bir branch'te olmalısınız (şu an ayrık HEAD).",
    );
    expect((await d.gh.run('b', { kind: 'createPr', title: '  ', body: '', base: 'main', draft: false })).message).toBe('PR başlığı boş olamaz.');

    git(repo, 'switch', '-q', 'main');
    git(repo, 'push', '-q'); // main güncel olsun → push gerekmez
    git(repo, 'switch', '-q', '-c', 'yeni', 'main');
    git(repo, 'push', '-q', '-u', 'origin', 'yeni');
    const unauthorized = services(repo, { responses: [{ status: 401, json: { message: 'Bad credentials' } }] });
    const r = await unauthorized.gh.run('c', { kind: 'createPr', title: 'x', body: '', base: 'main', draft: false });
    expect(r).toMatchObject({ ok: false, message: 'GitHub oturumu geçersiz — yeniden bağlanın.' });
    const exists = services(repo, { responses: [{ status: 422, json: { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for o:yeni.' }] } }] });
    expect((await exists.gh.run('d', { kind: 'createPr', title: 'x', body: '', base: 'main', draft: false })).message).toBe(
      'Bu branch için zaten açık bir PR var.',
    );
  }, T);

  it('mergePr: onay + uzak branch silme + fetch + main\'e geçip güncelleme', async () => {
    const repo = fixture();
    git(repo, 'push', '-q'); // main upstream ile eşit
    git(repo, 'switch', '-q', 'feature/graph');
    git(repo, 'push', '-q', '-u', 'origin', 'feature/graph');
    const p = pr({ number: 5, headRef: 'feature/graph', title: 'Graph kenarları' });

    const cancel = services(repo, { ui: new FakeUi([false]), prs: [p] });
    expect(await cancel.gh.run('a', { kind: 'mergePr', number: 5, method: 'squash', deleteBranch: true })).toMatchObject({
      ok: false,
      cancelled: true,
    });
    expect(cancel.ui.asked[0]).toBe(
      'confirm:PR #5 birleştirilsin mi?|"Graph kenarları"\nYöntem: squash · hedef: main\nUzak branch silinecek: feature/graph|Birleştir',
    );
    expect(cancel.calls).toHaveLength(0);

    const ui = new FakeUi([true], ['switch']);
    const s = services(repo, { ui, prs: [p], responses: [{ status: 200, json: { sha: 'abc123', merged: true } }, { status: 204 }] });
    const started: string[][] = [];
    const r = await s.gh.run('b', { kind: 'mergePr', number: 5, method: 'squash', deleteBranch: true }, (c) => started.push(c));
    expect(r.ok).toBe(true);
    expect(started).toEqual([['GitHub: PR #5 birleştir (squash)', "GitHub: uzak branch'i sil (feature/graph)", 'git fetch --prune']]);
    expect(r.commands).toEqual([
      'GitHub: PR #5 birleştir (squash)',
      "GitHub: uzak branch'i sil (feature/graph)",
      'git fetch --prune',
      'git switch main',
      'git pull --ff-only',
    ]);
    expect(r.message).toBe('PR #5 birleştirildi (squash). Uzak branch silindi. Geçildi: main. Zaten güncel.');
    expect(ui.asked[1]).toBe("pick:Şu an PR'ın branch'indesiniz: feature/graph|Geç ve güncelle: main/Burada kal");
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(s.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['PUT', 'https://api.github.com/repos/o/r/pulls/5/merge', { merge_method: 'squash' }],
      ['DELETE', 'https://api.github.com/repos/o/r/git/refs/heads/feature/graph', undefined],
    ]);
  }, T);

  it('mergePr: fork PR\'da uzak branch silinmez; başka branch\'teyken geçiş sorulmaz; PR yoksa hata', async () => {
    const repo = fixture();
    const fork = pr({ number: 7, headRef: 'patch-1', isCrossRepository: true });
    const s = services(repo, { ui: new FakeUi([true]), prs: [fork], responses: [{ status: 200, json: { sha: 'x' } }] });
    const r = await s.gh.run('a', { kind: 'mergePr', number: 7, method: 'merge', deleteBranch: true });
    expect(r).toMatchObject({ ok: true, message: 'PR #7 birleştirildi (merge).', commands: ['GitHub: PR #7 birleştir (merge)', 'git fetch --prune'] });
    expect(s.calls).toHaveLength(1);
    expect(s.ui.asked).toHaveLength(1);
    expect((await s.gh.run('b', { kind: 'mergePr', number: 99, method: 'merge', deleteBranch: false })).message).toBe(
      'PR #99 bulunamadı; listeyi yenileyin.',
    );
    const blocked = services(repo, { ui: new FakeUi([true]), prs: [fork], responses: [{ status: 405, json: { message: 'Required status check is failing' } }] });
    const rb = await blocked.gh.run('c', { kind: 'mergePr', number: 7, method: 'merge', deleteBranch: false });
    expect(rb.ok).toBe(false);
    expect(rb.message).toContain('PR birleştirilemedi');
  }, T);

  it('checkoutPr aynı repo: lokal yok → --track; lokal var → switch + ff', async () => {
    const repo = fixture();
    const p8 = pr({ number: 8, headRef: 'experiment/canvas' });
    const s = services(repo, { prs: [p8] });
    const r = await s.gh.run('a', { kind: 'checkoutPr', number: 8 });
    expect(r).toMatchObject({
      ok: true,
      message: 'Geçildi: experiment/canvas (PR #8).',
      commands: ['git fetch origin +refs/heads/experiment/canvas:refs/remotes/origin/experiment/canvas', 'git switch --track origin/experiment/canvas'],
    });
    expect(git(repo, 'branch', '--show-current')).toBe('experiment/canvas');
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/experiment/canvas');

    // Uzakta feature/graph'a yeni bir commit gelsin; yerel feature/graph var → switch + merge --ff-only
    git(repo, 'push', '-q', 'origin', 'feature/graph');
    const dir = await mkdtemp(join(tmpdir(), 'gitatlas-revrev-ghops-'));
    temps.push(dir);
    const other = join(dir, 'other');
    git(dir, 'clone', '-q', '-b', 'feature/graph', originOf(repo), other);
    git(other, 'config', 'user.name', 'Uzak');
    git(other, 'config', 'user.email', 'uzak@example.com');
    git(other, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(other, 'uzak.txt'), 'uzak\n');
    git(other, 'add', 'uzak.txt');
    git(other, 'commit', '-q', '-m', 'uzaktan yeni');
    git(other, 'push', '-q');

    const p5 = pr({ number: 5, headRef: 'feature/graph' });
    const s2 = services(repo, { prs: [p5] });
    const r2 = await s2.gh.run('b', { kind: 'checkoutPr', number: 5 });
    expect(r2).toMatchObject({
      ok: true,
      message: 'Geçildi: feature/graph (PR #5).',
      commands: [
        'git fetch origin +refs/heads/feature/graph:refs/remotes/origin/feature/graph',
        'git switch feature/graph',
        'git merge --ff-only origin/feature/graph',
      ],
    });
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('uzaktan yeni');
  }, T);

  it('checkoutPr fork (refs/pull/7/head) + kirli ağaç → sakla ve geç', async () => {
    const repo = fixture();
    const spikeTip = git(repo, 'rev-parse', 'spike/canvas');
    git(repo, 'push', '-q', 'origin', `${spikeTip}:refs/pull/7/head`);
    await writeFile(join(repo, 'README.md'), '# kirli\n');

    const fork = pr({ number: 7, headRef: 'patch-1', isCrossRepository: true });
    const cancel = services(repo, { ui: new FakeUi([], ['cancel']), prs: [fork] });
    expect(await cancel.gh.run('a', { kind: 'checkoutPr', number: 7 })).toMatchObject({ ok: false, cancelled: true });
    expect(git(repo, 'branch', '--show-current')).toBe('main');

    const ui = new FakeUi([], ['stash']);
    const s = services(repo, { ui, prs: [fork] });
    const r = await s.gh.run('b', { kind: 'checkoutPr', number: 7 });
    expect(r).toMatchObject({
      ok: true,
      message: 'Geçildi: pr/7 (PR #7). Değişiklikleriniz saklandı (stash@{0}).',
      commands: [
        'git fetch origin +refs/pull/7/head:refs/remotes/origin/pr/7',
        'git switch --no-track -c pr/7 origin/pr/7',
        'git stash push -u -m "GitAtlas-RevRev: pr/7 geçişinden önce"',
        'git switch --no-track -c pr/7 origin/pr/7',
      ],
    });
    expect(ui.asked[0]).toBe('pick:Commit edilmemiş değişiklikler geçişi engelliyor: pr/7|Değişiklikleri sakla (stash) ve geç/İptal');
    expect(git(repo, 'branch', '--show-current')).toBe('pr/7');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(spikeTip);
  }, T);

  it('kuyruk: GitHub işlemi ve git işlemleri aynı kuyrukta kilitlenmeden sırayla çalışır', async () => {
    const repo = fixture();
    git(repo, 'switch', '-q', 'feature/graph');
    await writeFile(join(repo, 'yeni.txt'), 'yeni\n');
    const s = services(repo, {
      ui: new FakeUi([true]),
      responses: [{ status: 201, json: { number: 3, html_url: 'https://github.com/o/r/pull/3' } }],
    });
    const busy: boolean[] = [];
    s.queue.onDidChangeBusy((b) => busy.push(b));
    const [a, b, c] = await Promise.all([
      s.gitOps.run('1', { kind: 'stage', paths: ['yeni.txt'] }),
      s.gh.run('2', { kind: 'createPr', title: 'Graph', body: '', base: 'main', draft: false }),
      s.gitOps.run('3', { kind: 'unstage', paths: ['yeni.txt'] }),
    ]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(b.commands).toContain('git push -u origin feature/graph');
    const order = s.log.filter((l) => l.startsWith('$ git ') || l.startsWith('GitHub:')).map((l) => l.split(' ').slice(0, 3).join(' '));
    expect(order).toEqual(['$ git add', '$ git push', 'GitHub: PR oluştur', '$ git restore']);
    expect(s.queue.busy).toBe(false);
    expect(busy).toEqual([true, false]);
  }, T);
});
