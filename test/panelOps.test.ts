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
import { opChangesRefs, parseGitOp, parseWebviewMessage, redactSecrets } from '../src/panel/panelProvider';
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
