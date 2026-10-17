import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): void => undefined;
    fire(): void {}
    dispose(): void {}
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

import { sanitizePullStrategy } from '../src/config';
import { branchContextValue, refFromCommandArg, validateBranchNameInput } from '../src/panel/branchTree';
import {
  detailFromBasic,
  findPrDetail,
  opChangesRefs,
  parseGitHubOp,
  parseGitOp,
  parseWebviewMessage,
  redactSecrets,
} from '../src/panel/panelProvider';
import type { PrPanelData, PullRequest } from '../src/types';
import { isRelevantChange } from '../src/panel/workingTreeWatcher';

describe('gitOp mesaj doğrulama', () => {
  const msg = (op: unknown, id: unknown = 'w-1'): unknown => parseWebviewMessage({ type: 'gitOp', id, op });

  it('geçerli işlemleri kabul eder', () => {
    expect(msg({ kind: 'stage', paths: ['src/a.ts', 'b.md'] })).toEqual({
      type: 'gitOp', id: 'w-1', op: { kind: 'stage', paths: ['src/a.ts', 'b.md'] },
    });
    expect(parseGitOp({ kind: 'stageAll' })).toEqual({ kind: 'stageAll' });
    expect(parseGitOp({ kind: 'commit', message: 'feat: x', amend: false, push: true })).toEqual({
      kind: 'commit', message: 'feat: x', amend: false, push: true,
    });
    expect(parseGitOp({ kind: 'pull' })).toEqual({ kind: 'pull' });
    expect(parseGitOp({ kind: 'pull', strategy: 'rebase' })).toEqual({ kind: 'pull', strategy: 'rebase' });
    expect(parseGitOp({ kind: 'push', force: true })).toEqual({ kind: 'push', force: true });
    expect(parseGitOp({ kind: 'checkout', branch: 'origin/feature/x' })).toEqual({ kind: 'checkout', branch: 'origin/feature/x' });
    expect(parseGitOp({ kind: 'createBranch', name: 'f/y', from: 'main', checkout: true })).toEqual({
      kind: 'createBranch', name: 'f/y', from: 'main', checkout: true,
    });
    expect(parseGitOp({ kind: 'renameBranch', from: 'a', to: 'b' })).toEqual({ kind: 'renameBranch', from: 'a', to: 'b' });
    expect(parseGitOp({ kind: 'stashSave', includeUntracked: true })).toEqual({ kind: 'stashSave', includeUntracked: true });
    expect(parseGitOp({ kind: 'stashApply', index: 0, pop: true })).toEqual({ kind: 'stashApply', index: 0, pop: true });
    expect(parseGitOp({ kind: 'abortOperation' })).toEqual({ kind: 'abortOperation' });
  });

  it('bozuk ve tehlikeli işlemleri reddeder', () => {
    expect(parseGitOp({ kind: 'stage', paths: ['../x'] })).toBeUndefined();
    expect(parseGitOp({ kind: 'stage', paths: [] })).toBeUndefined();
    expect(parseGitOp({ kind: 'discard', paths: ['/etc/passwd'] })).toBeUndefined();
    expect(parseGitOp({ kind: 'checkout', branch: '-x' })).toBeUndefined();
    expect(parseGitOp({ kind: 'createBranch', name: '--force', checkout: true })).toBeUndefined();
    expect(parseGitOp({ kind: 'deleteBranch', name: 'a..b' })).toBeUndefined();
    expect(parseGitOp({ kind: 'rm -rf' })).toBeUndefined();
    expect(parseGitOp({ kind: 'commit', message: 'x'.repeat(10001), amend: false, push: false })).toBeUndefined();
    expect(parseGitOp({ kind: 'commit', message: 'x' })).toBeUndefined();
    expect(parseGitOp({ kind: 'pull', strategy: 'octopus' })).toBeUndefined();
    expect(parseGitOp({ kind: 'push', force: 'yes' })).toBeUndefined();
    expect(parseGitOp({ kind: 'stashDrop', index: 1e9 })).toBeUndefined();
    expect(parseGitOp({ kind: 'stashDrop', index: -1 })).toBeUndefined();
    expect(parseGitOp({ kind: 'stashApply', index: 1.5, pop: false })).toBeUndefined();
    expect(msg({ kind: 'fetch' }, 'x'.repeat(65))).toBeUndefined();
    expect(msg({ kind: 'fetch' }, 3)).toBeUndefined();
    expect(msg(null)).toBeUndefined();
  });

  it('openChange ve showOutput', () => {
    expect(parseWebviewMessage({ type: 'openChange', path: 'src/a.ts', staged: true })).toEqual({
      type: 'openChange', path: 'src/a.ts', staged: true,
    });
    expect(parseWebviewMessage({ type: 'openChange', path: '../a.ts', staged: true })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'openChange', path: 'a.ts' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'showOutput' })).toEqual({ type: 'showOutput' });
    expect(parseWebviewMessage({ type: 'loadStatus' })).toEqual({ type: 'loadStatus' });
  });
});

describe('v5 yardımcıları', () => {
  it('ref değiştiren işlemler yeniden taramayı tetikler', () => {
    expect(opChangesRefs('commit')).toBe(true);
    expect(opChangesRefs('checkout')).toBe(true);
    expect(opChangesRefs('stage')).toBe(false);
    expect(opChangesRefs('stashDrop')).toBe(false);
  });

  it('çıktı kanalında token görünmez', () => {
    const token = 'gho_abcdefghijklmnopqrstuvwxyz0123';
    expect(redactSecrets(`push https://x-access-token:${token}@github.com/o/r`)).not.toContain(token);
    expect(redactSecrets(`token ${token}`)).toBe('token ***');
    expect(redactSecrets('secret=s3cr3t-value!', ['s3cr3t-value!'])).toBe('secret=***');
    expect(redactSecrets('Authorization: Bearer abc.def')).toBe('Authorization: Bearer ***');
    expect(redactSecrets('git commit -m "x"')).toBe('git commit -m "x"');
  });

  it('izleyici .git/objects ve node_modules değişikliklerini yok sayar', () => {
    expect(isRelevantChange('src/a.ts')).toBe(true);
    expect(isRelevantChange('.git/index')).toBe(true);
    expect(isRelevantChange('.git/HEAD')).toBe(true);
    expect(isRelevantChange('.git/MERGE_HEAD')).toBe(true);
    expect(isRelevantChange('.git/rebase-merge/done')).toBe(true);
    expect(isRelevantChange('.git/refs/heads/main')).toBe(true);
    expect(isRelevantChange('.git/objects/ab/cdef')).toBe(false);
    expect(isRelevantChange('.git/index.lock')).toBe(false);
    expect(isRelevantChange('node_modules/x/index.js')).toBe(false);
    expect(isRelevantChange('packages/a/node_modules/y.js')).toBe(false);
    expect(isRelevantChange('..\\outside.txt')).toBe(false);
  });

  it('pull stratejisi ayarı', () => {
    expect(sanitizePullStrategy('rebase')).toBe('rebase');
    expect(sanitizePullStrategy('merge')).toBe('merge');
    expect(sanitizePullStrategy('ff')).toBe('ask');
    expect(sanitizePullStrategy(undefined)).toBe('ask');
  });

  it('branch menü bağlamı', () => {
    expect(branchContextValue({ kind: 'local', isHead: true })).toBe('branch-local-head');
    expect(branchContextValue({ kind: 'local', isHead: false })).toBe('branch-local');
    expect(branchContextValue({ kind: 'remote', isHead: false })).toBe('branch-remote');
    expect(branchContextValue({ kind: 'tag', isHead: false })).toBeUndefined();
  });

  it('branch adı girişi doğrulaması ve komut argümanı', () => {
    const existing = new Set(['main', 'dev']);
    expect(validateBranchNameInput('feature/x', existing)).toBeUndefined();
    expect(validateBranchNameInput('  ', existing)).toBeDefined();
    expect(validateBranchNameInput('a b', existing)).toContain('Geçersiz');
    expect(validateBranchNameInput('-x', existing)).toContain('Geçersiz');
    expect(validateBranchNameInput('dev', existing)).toContain('zaten var');
    expect(validateBranchNameInput('dev', existing, 'dev')).toBeUndefined();
    const ref = { name: 'main', kind: 'local' };
    expect(refFromCommandArg({ kind: 'ref', section: 'local', ref })).toBe(ref);
    expect(refFromCommandArg({ kind: 'section', section: 'local', refs: [] })).toBeUndefined();
    expect(refFromCommandArg(undefined)).toBeUndefined();
  });
});

describe('v5 2. tur: PR mesajları', () => {
  const pr = (number: number): PullRequest => ({
    number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, author: 'a', headRef: `f${number}`,
    baseRef: 'main', isDraft: false, updatedAt: 0, files: ['a.ts', 'b.ts'], ci: 'success',
  });

  it('loadPrPanel / loadPrDraft', () => {
    expect(parseWebviewMessage({ type: 'loadPrPanel' })).toEqual({ type: 'loadPrPanel' });
    expect(parseWebviewMessage({ type: 'loadPrDraft' })).toEqual({ type: 'loadPrDraft' });
    expect(parseWebviewMessage({ type: 'loadPrDraft', base: 'develop' })).toEqual({ type: 'loadPrDraft', base: 'develop' });
    expect(parseWebviewMessage({ type: 'loadPrDraft', base: '-x' })).toBeUndefined();
  });

  it('githubOp doğrulaması', () => {
    const ok = { kind: 'createPr', title: 'feat: x', body: '', base: 'main', draft: false };
    expect(parseWebviewMessage({ type: 'githubOp', id: 'w1', op: ok })).toEqual({ type: 'githubOp', id: 'w1', op: ok });
    expect(parseGitHubOp({ ...ok, title: '' })).toBeUndefined();
    expect(parseGitHubOp({ ...ok, title: '   ' })).toBeUndefined();
    expect(parseGitHubOp({ ...ok, title: 'x'.repeat(257) })).toBeUndefined();
    expect(parseGitHubOp({ ...ok, body: 'x'.repeat(65537) })).toBeUndefined();
    expect(parseGitHubOp({ ...ok, base: '--upload-pack=x' })).toBeUndefined();
    expect(parseGitHubOp({ ...ok, draft: 'no' })).toBeUndefined();
    expect(parseGitHubOp({ kind: 'mergePr', number: 41, method: 'squash', deleteBranch: true })).toEqual({
      kind: 'mergePr', number: 41, method: 'squash', deleteBranch: true,
    });
    expect(parseGitHubOp({ kind: 'mergePr', number: 41, method: 'octopus', deleteBranch: true })).toBeUndefined();
    expect(parseGitHubOp({ kind: 'mergePr', number: 0, method: 'merge', deleteBranch: false })).toBeUndefined();
    expect(parseGitHubOp({ kind: 'checkoutPr', number: 7 })).toEqual({ kind: 'checkoutPr', number: 7 });
    expect(parseGitHubOp({ kind: 'checkoutPr', number: 1.5 })).toBeUndefined();
    expect(parseGitHubOp({ kind: 'closePr', number: 7 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'githubOp', id: '', op: { kind: 'checkoutPr', number: 7 } })).toBeUndefined();
  });

  it('PR ayrıntısı: önce PR paneli, yoksa temel listeden nötr alanlarla', () => {
    const detailed = { ...detailFromBasic(pr(41)), body: 'ayrıntılı', isCrossRepository: true };
    const panel: PrPanelData = {
      viewer: 'me', defaultBranch: 'main', mergeMethods: ['merge'], mine: [], reviewRequested: [detailed], fetchedAt: 0,
    };
    expect(findPrDetail(41, panel, [pr(41)])?.body).toBe('ayrıntılı');
    const basic = findPrDetail(42, panel, [pr(42)]);
    expect(basic).toMatchObject({ number: 42, body: '', isCrossRepository: false, mergeable: 'unknown', changedFiles: 2, checks: [] });
    expect(findPrDetail(99, undefined, [pr(42)])).toBeUndefined();
  });
});
