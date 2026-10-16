import { describe, expect, it, vi } from 'vitest';
import type { GitRef } from '../src/types';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): void => undefined;
    fire(): void {}
    dispose(): void {}
  },
  workspace: { getConfiguration: () => ({ get: () => [] }) },
}));

import {
  aheadBehindSentence,
  branchDescription,
  groupBranches,
  isStale,
  sortBranches,
} from '../src/panel/branchTree';
import { isSafeRefName, parseWebviewMessage } from '../src/panel/panelProvider';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 17);

const ref = (name: string, over: Partial<GitRef> = {}): GitRef => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: 'local',
  hash: 'abc',
  isHead: false,
  date: NOW - DAY,
  subject: 's',
  author: 'a',
  ...over,
});

describe('branch sıralama ve gruplama', () => {
  it('HEAD önce, sonra yeniden eskiye; tag ve origin/HEAD dışarıda', () => {
    const refs = [
      ref('old', { date: NOW - 40 * DAY }),
      ref('new', { date: NOW - DAY }),
      ref('main', { isHead: true, date: NOW - 10 * DAY }),
      ref('origin/main', { kind: 'remote', fullName: 'refs/remotes/origin/main' }),
      ref('origin/HEAD', { kind: 'remote', fullName: 'refs/remotes/origin/HEAD' }),
      ref('v1.0', { kind: 'tag', fullName: 'refs/tags/v1.0' }),
    ];
    expect(sortBranches(refs.slice(0, 3)).map((r) => r.name)).toEqual(['main', 'new', 'old']);
    const g = groupBranches(refs);
    expect(g.local.map((r) => r.name)).toEqual(['main', 'new', 'old']);
    expect(g.remote.map((r) => r.name)).toEqual(['origin/main']);
  });
});

describe('branch açıklaması', () => {
  it('bayat kuralı 30 gün', () => {
    expect(isStale(ref('x', { date: NOW - 31 * DAY }), NOW)).toBe(true);
    expect(isStale(ref('x', { date: NOW - 29 * DAY }), NOW)).toBe(false);
    expect(isStale(ref('x', { date: 0 }), NOW)).toBe(false);
  });
  it('HEAD · bayat · tarih · ↑↓; olmayan parçalar atlanır', () => {
    expect(branchDescription(ref('main', { isHead: true, ahead: 2, behind: 0 }), NOW)).toBe('HEAD · 1 gün önce · ↑2 ↓0');
    expect(branchDescription(ref('old', { date: NOW - 40 * DAY }), NOW)).toBe('bayat · 5 hafta önce');
  });
  it('ahead/behind cümlesi', () => {
    expect(aheadBehindSentence(ref('f', { compareTo: 'origin/main', ahead: 2, behind: 0 }))).toBe(
      'Karşılaştırma: origin/main · 2 ileride, 0 geride',
    );
    expect(aheadBehindSentence(ref('f', { upstream: 'origin/f', behind: 3 }))).toBe('Karşılaştırma: origin/f · 3 geride');
    expect(aheadBehindSentence(ref('f', { ahead: 1 }))).toBe('1 ileride');
    expect(aheadBehindSentence(ref('f'))).toBeUndefined();
  });
});

describe('loadGraph mesaj doğrulama', () => {
  it('limit ve branch adını doğrular', () => {
    expect(parseWebviewMessage({ type: 'loadGraph', limit: 500 })).toEqual({ type: 'loadGraph', limit: 500 });
    expect(parseWebviewMessage({ type: 'loadGraph', limit: 500, branch: 'origin/feature/x' })).toEqual({
      type: 'loadGraph',
      limit: 500,
      branch: 'origin/feature/x',
    });
    expect(parseWebviewMessage({ type: 'loadGraph', limit: 0 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'loadGraph', limit: 20001 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'loadGraph', limit: 1.5 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'loadGraph', limit: 10, branch: '--all' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'loadGraph', limit: 10, branch: 3 })).toBeUndefined();
    expect(isSafeRefName('a..b')).toBe(false);
    expect(isSafeRefName('a b')).toBe(false);
    expect(isSafeRefName('main')).toBe(true);
  });
});
