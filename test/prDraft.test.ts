import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPrDraft, computePrDraft, titleFromBranch } from '../src/ops/prDraft';
import type { CommitSummary } from '../src/types';

function c(message: string): CommitSummary {
  return { hash: message, shortHash: message.slice(0, 7), parents: [], author: 'a', email: 'a@x', date: 0, message, files: [] };
}

describe('titleFromBranch', () => {
  it('son "/" sonrası, - ve _ boşluk, ilk harf büyük', () => {
    expect(titleFromBranch('feature/graph-kenarlari')).toBe('Graph kenarlari');
    expect(titleFromBranch('fix/parser_bos__satir')).toBe('Parser bos satir');
    expect(titleFromBranch('a/b/c-d')).toBe('C d');
    expect(titleFromBranch('main')).toBe('Main');
    expect(titleFromBranch('-x-')).toBe('X');
    expect(titleFromBranch('feature/')).toBe('feature/');
  });
});

describe('buildPrDraft', () => {
  it('tek commit: başlık = mesaj, açıklama boş', () => {
    expect(buildPrDraft([c('feat: graph kenarları')], 'feature/graph', 'main')).toEqual({ title: 'feat: graph kenarları', body: '' });
  });

  it('çok commit: başlık branch adından, açıklama eskiden yeniye madde listesi', () => {
    // git log sırası: en yeniden en eskiye
    const d = buildPrDraft([c('üçüncü'), c('ikinci'), c('birinci')], 'feature/graph-kenarlari', 'main');
    expect(d.title).toBe('Graph kenarlari');
    expect(d.body).toBe('## Değişiklikler\n\n- birinci\n- ikinci\n- üçüncü');
  });

  it('commit yoksa başlık branch adından, açıklama boş', () => {
    expect(buildPrDraft([], 'fix/x', 'main')).toEqual({ title: 'X', body: '' });
  });
});

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
  for (const cand of candidates) {
    if (cand !== 'bash' && !existsSync(cand)) continue;
    try {
      execFileSync(cand, ['-c', 'git --version'], { stdio: 'ignore' });
      return cand;
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

describe.skipIf(!bash)('computePrDraft (fixture)', () => {
  it('feature/graph → main: 3 commit, gönderilmemiş', async () => {
    const repo = execFileSync(bash!, [resolve(__dirname, '..', 'scripts', 'make-fixture.sh')], { encoding: 'utf8' }).trim();
    temps.push(repo);
    execFileSync('git', ['switch', '-q', 'feature/graph'], { cwd: repo });

    const d = await computePrDraft(repo, undefined, 'main');
    expect(d).toEqual({
      head: 'feature/graph',
      base: 'main',
      title: 'Graph',
      body: '## Değişiklikler\n\n- feat: graph iskeleti\n- feat: graph şeritleri\n- feat: graph kenarları',
      commits: 3,
      needsPush: true,
    });
    // base verilmezse ve varsayılan da yoksa 'main'
    expect((await computePrDraft(repo, undefined, undefined)).base).toBe('main');
    // origin'de olmayan base: yerel ref'e düşer
    const fromFix = await computePrDraft(repo, 'fix/parser', undefined);
    expect(fromFix.base).toBe('fix/parser');
    expect(fromFix.commits).toBeGreaterThan(3);
    await expect(computePrDraft(repo, 'yok-boyle-bir-branch', undefined)).rejects.toThrow('Hedef branch bulunamadı: yok-boyle-bir-branch');

    // main: upstream var, ↑2 → needsPush; tek commit değil (2) → başlık branch adından
    execFileSync('git', ['switch', '-q', 'main'], { cwd: repo });
    const m = await computePrDraft(repo, 'main', undefined);
    expect(m).toMatchObject({ head: 'main', commits: 2, needsPush: true, title: 'Main' });

    execFileSync('git', ['switch', '-q', '--detach'], { cwd: repo });
    await expect(computePrDraft(repo, 'main', undefined)).rejects.toThrow("PR açmak için bir branch'te olmalısınız");
  }, 60_000);
});
