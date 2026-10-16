import { describe, expect, it, vi } from 'vitest';
import type { FileStat, GitHubData } from '../src/types';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): void => undefined;
    fire(): void {}
    dispose(): void {}
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

import { computeBadges, countPrsByFile, prBadgeText } from '../src/decorations/heatDecorations';
import { githubStatusText } from '../src/panel/statusBar';

const file = (path: string, changes: number): FileStat => ({
  path, lines: 10, changes, added: 0, deleted: 0, lastModified: 0, authors: [],
});

const files = [...Array.from({ length: 10 }, (_, i) => file(`f${i}`, i + 1)), file('cold', 0)];

describe('Explorer rozet modları', () => {
  it("'off' → hiç rozet yok (PR olsa bile)", () => {
    expect(computeBadges(files, 'off', new Map([['f0', 3]])).size).toBe(0);
  });
  it("'hot' → yalnızca ●●/●", () => {
    const b = computeBadges(files, 'hot');
    expect(b.get('f9')?.badge).toBe('●●');
    expect([...b.values()].every((x) => x.badge === '●●' || x.badge === '●')).toBe(true);
    expect(b.has('cold')).toBe(false);
  });
  it("'all' → değişen her dosyada 1..5, değişmeyende yok", () => {
    const b = computeBadges(files, 'all');
    expect(b.size).toBe(10);
    expect(b.get('f9')?.badge).toBe('5');
    expect(b.get('f0')?.badge).toBe('1');
    expect(b.has('cold')).toBe(false);
  });
  it('2+ PR ısının önüne geçer; tek PR geçmez; değişmeyen dosyada da görünür', () => {
    const prCounts = new Map([['f9', 2], ['f8', 1], ['cold', 12]]);
    const b = computeBadges(files, 'hot', prCounts);
    expect(b.get('f9')).toMatchObject({ kind: 'pr', badge: '2' });
    expect(b.get('f9')?.tooltip).toContain('2 açık PR');
    expect(b.get('f8')?.kind).toBe('heat');
    expect(b.get('cold')?.badge).toBe('9+');
  });
  it('tüm rozetler en fazla 2 karakter', () => {
    const prCounts = new Map(files.map((f, i) => [f.path, i * 3]));
    for (const mode of ['hot', 'all'] as const) {
      for (const spec of computeBadges(files, mode, prCounts).values()) expect(spec.badge.length).toBeLessThanOrEqual(2);
    }
    expect(prBadgeText(9)).toBe('9');
    expect(prBadgeText(10)).toBe('9+');
  });
  it('PR sayımı dosya başına, aynı PR iki kez sayılmaz', () => {
    const c = countPrsByFile([{ files: ['a', 'b', 'a'] }, { files: ['a'] }]);
    expect(c.get('a')).toBe(2);
    expect(c.get('b')).toBe(1);
  });
});

describe('durum çubuğu GitHub parçası', () => {
  const now = Date.UTC(2026, 9, 17, 12);
  const base = { branchCi: [], pullRequests: [] } as Omit<GitHubData, 'status'>;
  it('bağlı → "GitHub: N PR", eski veri → "GitHub: eski veri", kapalı → yok', () => {
    const connected: GitHubData = {
      ...base,
      pullRequests: [
        { number: 1, title: 't', url: 'u', author: 'a', headRef: 'x', baseRef: 'main', isDraft: false, updatedAt: 0, files: [], ci: 'none' },
      ],
      status: { state: 'connected', repo: 'o/r', fetchedAt: now - 60_000, intervalMin: 2, baseIntervalMin: 2 },
    };
    expect(githubStatusText(connected, now)?.suffix).toBe('GitHub: 1 PR');
    expect(githubStatusText(connected, now)?.detail).toContain('o/r');
    const stale: GitHubData = { ...base, status: { state: 'stale', repo: 'o/r', fetchedAt: now - 3 * 3600_000, reason: 'offline' } };
    expect(githubStatusText(stale, now)?.suffix).toBe('GitHub: eski veri');
    expect(githubStatusText({ ...base, status: { state: 'off', dismissed: false } }, now)).toBeUndefined();
    expect(githubStatusText(undefined, now)).toBeUndefined();
  });
});
