import { describe, expect, it } from 'vitest';
import { formatCommand, isValidBranchName, opCommands, splitMessage } from '../src/git/opCommands';
import type { GitOpRequest, WorkingTreeStatus } from '../src/types';

const base: WorkingTreeStatus = {
  branch: 'feature/x',
  head: 'a'.repeat(40),
  upstream: 'origin/feature/x',
  ahead: 0,
  behind: 0,
  files: [
    { path: 'src/a.ts', unstaged: 'modified', conflicted: false },
    { path: 'yeni dosya.txt', unstaged: 'untracked', conflicted: false },
  ],
  stashCount: 0,
};
const noUpstream: WorkingTreeStatus = { ...base, upstream: undefined };
const empty: WorkingTreeStatus = { ...base, head: undefined, upstream: undefined };

describe('opCommands', () => {
  const cases: [string, GitOpRequest, WorkingTreeStatus | undefined, string[][]][] = [
    ['stage', { kind: 'stage', paths: ['a', '-b'] }, base, [['add', '--', 'a', '-b']]],
    ['stage boş', { kind: 'stage', paths: [] }, base, []],
    ['stageAll', { kind: 'stageAll' }, base, [['add', '-A']]],
    ['unstage', { kind: 'unstage', paths: ['a'] }, base, [['restore', '--staged', '--', 'a']]],
    ['unstage (HEAD yok)', { kind: 'unstage', paths: ['a'] }, empty, [['rm', '--cached', '-r', '--', 'a']]],
    ['unstageAll', { kind: 'unstageAll' }, base, [['restore', '--staged', '--', '.']]],
    ['unstageAll (HEAD yok)', { kind: 'unstageAll' }, empty, [['rm', '--cached', '-r', '--', '.']]],
    [
      'discard tracked + untracked',
      { kind: 'discard', paths: ['src/a.ts', 'yeni dosya.txt'] },
      base,
      [
        ['restore', '--worktree', '--', 'src/a.ts'],
        ['clean', '-f', '--', 'yeni dosya.txt'],
      ],
    ],
    ['commit tek satır', { kind: 'commit', message: 'feat: x', amend: false, push: false }, base, [['commit', '-m', 'feat: x']]],
    [
      'commit açıklamalı + amend',
      { kind: 'commit', message: 'feat: x\r\n\r\nayrıntı 1\nayrıntı 2\n', amend: true, push: false },
      base,
      [['commit', '-m', 'feat: x', '-m', 'ayrıntı 1\nayrıntı 2', '--amend']],
    ],
    ['amend mesajsız', { kind: 'commit', message: '  ', amend: true, push: false }, base, [['commit', '--no-edit', '--amend']]],
    [
      'commit + push (upstream yok)',
      { kind: 'commit', message: 'fix: y', amend: false, push: true },
      noUpstream,
      [
        ['commit', '-m', 'fix: y'],
        ['push', '-u', 'origin', 'feature/x'],
      ],
    ],
    ['undoLastCommit', { kind: 'undoLastCommit' }, base, [['reset', '--soft', 'HEAD~1']]],
    ['fetch', { kind: 'fetch' }, base, [['fetch', '--prune']]],
    ['pull varsayılan', { kind: 'pull' }, base, [['pull', '--ff-only']]],
    ['pull ff', { kind: 'pull', strategy: 'ff' }, base, [['pull', '--ff-only']]],
    ['pull merge', { kind: 'pull', strategy: 'merge' }, base, [['pull', '--no-rebase']]],
    ['pull rebase', { kind: 'pull', strategy: 'rebase' }, base, [['pull', '--rebase']]],
    ['push', { kind: 'push' }, base, [['push']]],
    ['push force', { kind: 'push', force: true }, base, [['push', '--force-with-lease']]],
    ['push upstream yok', { kind: 'push' }, noUpstream, [['push', '-u', 'origin', 'feature/x']]],
    ['push status yok', { kind: 'push' }, undefined, [['push']]],
    ['checkout lokal', { kind: 'checkout', branch: 'dev' }, base, [['switch', 'dev']]],
    ['checkout remote', { kind: 'checkout', branch: 'origin/dev' }, base, [['switch', '--track', 'origin/dev']]],
    ['createBranch', { kind: 'createBranch', name: 'f/y', checkout: true }, base, [['switch', '-c', 'f/y']]],
    ['createBranch from', { kind: 'createBranch', name: 'f/y', from: 'main', checkout: true }, base, [['switch', '-c', 'f/y', 'main']]],
    ['createBranch checkout yok', { kind: 'createBranch', name: 'f/y', from: 'main', checkout: false }, base, [['branch', 'f/y', 'main']]],
    ['mergeBranch', { kind: 'mergeBranch', branch: 'dev' }, base, [['merge', '--no-edit', 'dev']]],
    ['renameBranch', { kind: 'renameBranch', from: 'a', to: 'b' }, base, [['branch', '-m', 'a', 'b']]],
    ['deleteBranch', { kind: 'deleteBranch', name: 'a' }, base, [['branch', '-d', 'a']]],
    ['stashSave', { kind: 'stashSave', includeUntracked: false }, base, [['stash', 'push']]],
    ['stashSave -u -m', { kind: 'stashSave', includeUntracked: true, message: ' yarım ' }, base, [['stash', 'push', '-u', '-m', 'yarım']]],
    ['stashApply', { kind: 'stashApply', index: 2, pop: false }, base, [['stash', 'apply', 'stash@{2}']]],
    ['stashPop', { kind: 'stashApply', index: 0, pop: true }, base, [['stash', 'pop', 'stash@{0}']]],
    ['stashDrop', { kind: 'stashDrop', index: 1 }, base, [['stash', 'drop', 'stash@{1}']]],
    ['markResolved', { kind: 'markResolved', paths: ['a'] }, base, [['add', '--', 'a']]],
    ['continue (işlem yok)', { kind: 'continueOperation' }, base, []],
    ['continue merge', { kind: 'continueOperation' }, { ...base, operation: 'merge' }, [['commit', '--no-edit']]],
    ['continue rebase', { kind: 'continueOperation' }, { ...base, operation: 'rebase' }, [['rebase', '--continue']]],
    ['continue cherryPick', { kind: 'continueOperation' }, { ...base, operation: 'cherryPick' }, [['cherry-pick', '--continue']]],
    ['continue revert', { kind: 'continueOperation' }, { ...base, operation: 'revert' }, [['revert', '--continue']]],
    ['abort merge', { kind: 'abortOperation' }, { ...base, operation: 'merge' }, [['merge', '--abort']]],
    ['abort rebase', { kind: 'abortOperation' }, { ...base, operation: 'rebase' }, [['rebase', '--abort']]],
    ['abort cherryPick', { kind: 'abortOperation' }, { ...base, operation: 'cherryPick' }, [['cherry-pick', '--abort']]],
    ['abort revert', { kind: 'abortOperation' }, { ...base, operation: 'revert' }, [['revert', '--abort']]],
  ];
  it.each(cases)('%s', (_name, op, status, expected) => {
    expect(opCommands(op, status)).toEqual(expected);
  });

  it('checkout: aynı adlı lokal varsa ona geçer; başka remote', () => {
    expect(opCommands({ kind: 'checkout', branch: 'origin/dev' }, base, { localBranches: ['dev'] })).toEqual([['switch', 'dev']]);
    expect(opCommands({ kind: 'checkout', branch: 'upstream/dev' }, base, { remotes: ['origin', 'upstream'] })).toEqual([
      ['switch', '--track', 'upstream/dev'],
    ]);
    expect(opCommands({ kind: 'checkout', branch: 'origin/dev' }, base, { localBranches: ['origin/dev'] })).toEqual([['switch', 'origin/dev']]);
  });

  it('splitMessage', () => {
    expect(splitMessage('özet')).toEqual({ summary: 'özet', body: '' });
    expect(splitMessage('özet\ndevam')).toEqual({ summary: 'özet', body: 'devam' });
    expect(splitMessage('özet\n\n\n  girintili\n\nson\n\n')).toEqual({ summary: 'özet', body: '  girintili\n\nson' });
  });
});

describe('formatCommand', () => {
  it('tırnaklama', () => {
    expect(formatCommand(['push', '-u', 'origin', 'feature/x'])).toBe('git push -u origin feature/x');
    expect(formatCommand(['commit', '-m', 'feat: iki kelime'])).toBe('git commit -m "feat: iki kelime"');
    expect(formatCommand(['commit', '-m', 'a "b" $c'])).toBe('git commit -m "a \\"b\\" \\$c"');
    expect(formatCommand(['add', '--', 'yeni dosya.txt', ''])).toBe('git add -- "yeni dosya.txt" ""');
    expect(formatCommand(['stash', 'apply', 'stash@{0}'])).toBe('git stash apply stash@{0}');
  });
});

describe('isValidBranchName', () => {
  it.each(['main', 'feature/x', 'fix-1.2', 'kullanıcı/özellik', 'a/b/c', 'v1.0'])('geçerli: %s', (n) => {
    expect(isValidBranchName(n)).toBe(true);
  });
  it.each([
    '',
    '@',
    'HEAD',
    '-x',
    '/a',
    'a/',
    'a.',
    'a..b',
    'a//b',
    'a@{b',
    'a b',
    'a~b',
    'a^b',
    'a:b',
    'a?b',
    'a*b',
    'a[b',
    'a\\b',
    'a\tb',
    '.gizli',
    'a/.b',
    'a.lock',
    'a/b.lock/c',
    'x'.repeat(256),
  ])('geçersiz: %j', (n) => {
    expect(isValidBranchName(n)).toBe(false);
  });
});
