// İngilizce dil desteği: git işlemleri, git çalıştırıcısı ve GitHub katmanı metinleri.
// Gerçek git'e karşı birkaç işlem setLang('en') ile çalıştırılır; Türkçe varsayılan her testten sonra geri gelir.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { GitError, runGit, setGitPath } from '../src/git/gitRunner';
import { createPullRequest, mergePullRequest } from '../src/github/prApi';
import { text as githubText } from '../src/i18n/github';
import { setLang } from '../src/i18n/index';
import { text as opsText } from '../src/i18n/ops';
import { GitOpsService, type OpsUi } from '../src/ops/gitOpsService';
import { buildPrDraft } from '../src/ops/prDraft';
import type { CommitSummary, GitOpRequest, OpResult } from '../src/types';

const T = 60_000;
const temps: string[] = [];

afterEach(() => setLang('tr'));
afterAll(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function configure(repo: string): void {
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', '.git/hooks');
}

/** Bare origin + main'i gönderilmiş çalışma reposu. */
async function setup(): Promise<{ dir: string; repo: string; origin: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'gitatlas-revrev-i18n-'));
  temps.push(dir);
  const origin = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-q', '-b', 'main', repo);
  configure(repo);
  await writeFile(join(repo, 'a.txt'), 'a\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return { dir, repo, origin };
}

class FakeUi implements OpsUi {
  readonly asked: string[] = [];
  constructor(private readonly confirms: boolean[] = []) {}
  confirm(message: string, detail: string, action: string): Promise<boolean> {
    this.asked.push(`confirm:${message}|${detail}|${action}`);
    return Promise.resolve(this.confirms.shift() ?? false);
  }
  pick<T extends string>(title: string, items: { id: T; label: string }[]): Promise<T | undefined> {
    this.asked.push(`pick:${title}|${items.map((i) => i.label).join('/')}`);
    return Promise.resolve(undefined);
  }
}

function service(repo: string, ui: OpsUi = new FakeUi()): { svc: GitOpsService; log: string[] } {
  const log: string[] = [];
  const svc = new GitOpsService({ root: repo, ui, pullStrategy: () => 'ask', log: (l) => log.push(l) });
  return { svc, log };
}

let seq = 0;
const run = (svc: GitOpsService, op: GitOpRequest): Promise<OpResult> => svc.run(`en${++seq}`, op);

describe('i18n/ops sözlüğü', () => {
  it('Türkçe varsayılan; İngilizcede tekil/çoğul doğru', () => {
    expect(opsText().staged(2)).toBe("2 dosya commit'e eklendi.");
    setLang('en');
    const t = opsText();
    expect(t.staged(1)).toBe('Staged 1 file.');
    expect(t.staged(3)).toBe('Staged 3 files.');
    expect(t.pushed('origin/main', 1)).toBe('Pushed 1 commit to origin/main.');
    expect(t.pushed('origin/main', 2)).toBe('Pushed 2 commits to origin/main.');
    expect(t.discardMore(4)).toBe('\n… and 4 more files');
    expect(t.opFailedSeeOutput('push')).toBe("Couldn't push. See the output for details.");
    // Ref adına ek yok; doğal İngilizce.
    expect(t.switched('main')).toBe('Switched to main.');
  });

  it('sözlüklerde boş metin yok (iki dilde)', () => {
    for (const lang of ['tr', 'en'] as const) {
      setLang(lang);
      for (const table of [opsText(), githubText()]) {
        for (const [key, value] of Object.entries(table)) {
          if (typeof value === 'string') expect(value.trim(), `${lang}.${key}`).not.toBe('');
        }
      }
    }
  });

  it('PR taslağı: yalnızca sabit başlık çevrilir, commit mesajları aynen kalır', () => {
    const c = (message: string): CommitSummary => ({ hash: message, shortHash: message, parents: [], author: 'a', email: 'e', date: 0, message, files: [] });
    setLang('en');
    expect(buildPrDraft([c('ikinci'), c('birinci')], 'feature/graph-edges', 'main')).toEqual({
      title: 'Graph edges',
      body: '## Changes\n\n- birinci\n- ikinci',
    });
  });
});

describe('GitOpsService (İngilizce, gerçek git)', () => {
  it(
    'stage / commit / nothing to push / checkout',
    async () => {
      const { repo } = await setup();
      setLang('en');
      const { svc } = service(repo);

      await writeFile(join(repo, 'a.txt'), 'changed\n', 'utf8');
      await writeFile(join(repo, 'b.txt'), 'new\n', 'utf8');
      expect((await run(svc, { kind: 'stageAll' })).message).toBe('Staged 2 files.');
      expect((await run(svc, { kind: 'unstage', paths: ['a.txt'] })).message).toBe('Unstaged 1 file.');
      expect((await run(svc, { kind: 'stage', paths: ['a.txt'] })).message).toBe('Staged 1 file.');

      const committed = await run(svc, { kind: 'commit', message: 'feat: english', amend: false, push: false });
      expect(committed.ok).toBe(true);
      expect(committed.message).toMatch(/^Committed [0-9a-f]+ feat: english\.$/);
      expect((await run(svc, { kind: 'commit', message: 'again', amend: false, push: false })).message).toBe('Nothing staged. Select files first.');

      expect((await run(svc, { kind: 'push' })).message).toBe('Pushed 1 commit to origin/main.');
      expect((await run(svc, { kind: 'push' })).message).toBe('Nothing to push; origin/main is up to date.');

      expect((await run(svc, { kind: 'createBranch', name: 'feature', checkout: false })).message).toBe('Created branch feature.');
      expect((await run(svc, { kind: 'checkout', branch: 'feature' })).message).toBe('Switched to feature.');
      expect((await run(svc, { kind: 'checkout', branch: 'feature' })).message).toBe('Already on feature.');
      expect((await run(svc, { kind: 'createBranch', name: 'bad name', checkout: false })).message).toMatch(/^Invalid branch name: "bad name"\./);
    },
    T,
  );

  it(
    'onay diyaloğu metinleri ve iptal İngilizce',
    async () => {
      const { repo } = await setup();
      setLang('en');
      const ui = new FakeUi([false]);
      const { svc } = service(repo, ui);
      await writeFile(join(repo, 'a.txt'), 'changed\n', 'utf8');
      const r = await run(svc, { kind: 'discard', paths: ['a.txt'] });
      expect(r).toMatchObject({ ok: false, cancelled: true, message: 'Cancelled.' });
      expect(ui.asked[0]).toBe("confirm:Changes in 1 file will be permanently discarded.|a.txt\n\nThis can't be undone.|Discard");
    },
    T,
  );

  it(
    'kimlik hatası sınıflandırması İngilizce mesaj verir',
    async () => {
      const { repo, origin } = await setup();
      const hook = join(origin, 'hooks', 'pre-receive');
      await writeFile(hook, '#!/bin/sh\necho "fatal: Authentication failed for origin" >&2\nexit 1\n', { mode: 0o755 });
      git(origin, 'config', 'core.hooksPath', join(origin, 'hooks').replace(/\\/g, '/'));
      await writeFile(join(repo, 'a.txt'), 'x\n', 'utf8');
      git(repo, 'commit', '-q', '-am', 'x');

      setLang('en');
      const getToken = vi.fn(() => Promise.resolve<string | undefined>(undefined));
      const log: string[] = [];
      const svc = new GitOpsService({ root: repo, ui: new FakeUi(), pullStrategy: () => 'ask', log: (l) => log.push(l), getToken });
      const r = await run(svc, { kind: 'push' });
      expect(r.ok).toBe(false);
      expect(r.message).toBe('Authentication failed. Set up your Git credentials or connect to GitHub in GitAtlas-Rev.');
    },
    T,
  );
});

describe('gitRunner (İngilizce)', () => {
  it(
    'git reposu olmayan klasör; zaman aşımı bayrağı dilden bağımsız',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'gitatlas-revrev-norepo-'));
      temps.push(dir);
      setLang('en');
      await expect(runGit(['status'], dir)).rejects.toMatchObject({ code: 'notRepo', message: 'This folder is not a git repository.' });

      // Süre dolması makinenin hızına bağlı olmasın: "git" yerine uyuyan bir node süreci çalışır.
      setGitPath(process.execPath);
      const err: unknown = await runGit(['-e', 'setTimeout(() => {}, 10000)'], dir, { timeoutMs: 100 })
        .catch((e: unknown) => e)
        .finally(() => setGitPath(undefined));
      expect(err).toBeInstanceOf(GitError);
      expect((err as GitError).timedOut).toBe(true);
      expect((err as GitError).message).toBe('Git operation timed out (0 s).');
    },
    T,
  );
});

describe('GitHub katmanı (İngilizce)', () => {
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchOf = (res: () => Response): typeof fetch => (() => Promise.resolve(res())) as unknown as typeof fetch;
  const input = { title: 't', body: '', head: 'h', base: 'main', draft: false };

  it('PR açma ve birleştirme hataları', async () => {
    setLang('en');
    const exists = { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for o:h.' }] };
    await expect(createPullRequest('tok', 'o', 'r', input, fetchOf(() => json(exists, 422)))).rejects.toMatchObject({
      message: 'There is already an open PR for this branch.',
    });
    await expect(mergePullRequest('tok', 'o', 'r', 7, 'squash', fetchOf(() => json({ message: 'Head branch was modified' }, 409)))).rejects.toMatchObject({
      message: "The PR's head changed; refresh and try again.",
    });
    await expect(createPullRequest('tok', 'o', 'r', input, fetchOf(() => json({ message: 'boom' }, 500)))).rejects.toMatchObject({
      message: 'GitHub request failed (HTTP 500).',
    });
  });

  it('Türkçe varsayılan korunur', async () => {
    const exists = { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for o:h.' }] };
    await expect(createPullRequest('tok', 'o', 'r', input, fetchOf(() => json(exists, 422)))).rejects.toMatchObject({
      message: 'Bu branch için zaten açık bir PR var.',
    });
  });
});
