import { describe, expect, it, vi } from 'vitest';
import type { CommitSummary, FileStat } from '../src/types';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): void => undefined;
    fire(): void {}
    dispose(): void {}
  },
  workspace: { getConfiguration: () => ({ get: () => [] }) },
}));

import { heatLevels, levelsFor, recencyLevels } from '../src/webview/heat';
import { recentCommitsForFile } from '../src/webview/fileCard';
import { computeHeatTiers, heatBadge } from '../src/decorations/heatDecorations';
import { isSafeRelPath, parseWebviewMessage } from '../src/panel/panelProvider';
import { sanitizeIgnore } from '../src/config';

const file = (path: string, changes: number): FileStat => ({
  path, lines: 10, changes, added: 0, deleted: 0, lastModified: 0, authors: [],
});

const commit = (hash: string, files: CommitSummary['files']): CommitSummary => ({
  hash, shortHash: hash.slice(0, 7), parents: [], author: 'a', email: 'a@x', date: 0, message: hash, files,
});

describe('heatLevels', () => {
  it('0 değişiklik → 0, diğerleri yüzdelik dilime göre 1..5, eşitler aynı seviye', () => {
    const files = [file('a', 0), ...Array.from({ length: 10 }, (_, i) => file(`f${i}`, i + 1)), file('tie', 10)];
    const h = heatLevels(files);
    expect(h.get('a')).toBe(0);
    expect(h.get('f0')).toBe(1);
    expect(h.get('f9')).toBe(5);
    expect(h.get('tie')).toBe(h.get('f9'));
    expect(h.get('f4')).toBe(3);
  });

  it("çoğunluğu oluşturan eşitler grubun en alt sırasını alır (genç repoda 1 commit'likler soğuk kalır)", () => {
    const files = [
      ...Array.from({ length: 7 }, (_, i) => file(`once${i}`, 1)),
      file('twice', 2),
      file('busy', 5),
      file('hot', 9),
    ];
    const h = heatLevels(files);
    for (let i = 0; i < 7; i++) expect(h.get(`once${i}`)).toBe(1);
    expect(h.get('twice')).toBe(4);
    expect(h.get('busy')).toBe(5);
    expect(h.get('hot')).toBe(5);
  });

  it('hepsi aynı sayıda değiştiyse hepsi en soğuk değişen seviyede', () => {
    const h = heatLevels([file('a', 1), file('b', 1), file('c', 1)]);
    expect([...h.values()]).toEqual([1, 1, 1]);
  });
});

describe('recencyLevels', () => {
  const NOW = Date.UTC(2026, 9, 24, 12);
  const at = (path: string, daysAgo: number): FileStat => ({ ...file(path, 1), lastModified: daysAgo < 0 ? 0 : NOW - daysAgo * 864e5 });

  it("son değişiklikten bu yana geçen süreye göre sabit dilimler; commit'i olmayan 0", () => {
    const h = recencyLevels([at('today', 0.2), at('d2', 2), at('d5', 5), at('d20', 20), at('old', 90), at('none', -1)], NOW);
    expect([...h.values()]).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('dilim sınırları kapsayıcıdır', () => {
    const h = recencyLevels([at('a', 1), at('b', 3), at('c', 7), at('d', 30), at('e', 30.01)], NOW);
    expect([...h.values()]).toEqual([5, 4, 3, 2, 1]);
  });

  it("webview'dan gelen setColorMode/repoMenu doğrulanır", () => {
    expect(parseWebviewMessage({ type: 'setColorMode', mode: 'recency' })).toEqual({ type: 'setColorMode', mode: 'recency' });
    expect(parseWebviewMessage({ type: 'setColorMode', mode: 'rainbow' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'repoMenu' })).toEqual({ type: 'repoMenu' });
  });

  it('bisect mesajları doğrulanır (ref adı, işaret türü)', () => {
    const op = (o: unknown): unknown => parseWebviewMessage({ type: 'gitOp', id: 'x', op: o });
    expect(parseWebviewMessage({ type: 'loadBisect' })).toEqual({ type: 'loadBisect' });
    expect(op({ kind: 'bisectStart', bad: 'HEAD', good: 'v1.0' })).toMatchObject({ op: { kind: 'bisectStart', bad: 'HEAD', good: 'v1.0' } });
    expect(op({ kind: 'bisectStart', bad: 'HEAD', good: '--force' })).toBeUndefined();
    expect(op({ kind: 'bisectMark', mark: 'skip' })).toMatchObject({ op: { kind: 'bisectMark', mark: 'skip' } });
    expect(op({ kind: 'bisectMark', mark: 'good', rev: 'abc1234' })).toMatchObject({ op: { kind: 'bisectMark', mark: 'good', rev: 'abc1234' } });
    expect(op({ kind: 'bisectMark', mark: 'maybe' })).toBeUndefined();
    expect(op({ kind: 'bisectReset' })).toMatchObject({ op: { kind: 'bisectReset' } });
  });

  it("openMergeEditor ve resolveSide yalnızca güvenli yol ve geçerli tarafla kabul edilir", () => {
    expect(parseWebviewMessage({ type: 'openMergeEditor', path: 'src/a.ts' })).toEqual({ type: 'openMergeEditor', path: 'src/a.ts' });
    expect(parseWebviewMessage({ type: 'openMergeEditor', path: '../x' })).toBeUndefined();
    const op = (o: unknown): unknown => parseWebviewMessage({ type: 'gitOp', id: 'x', op: o });
    expect(op({ kind: 'resolveSide', path: 'a.txt', side: 'theirs' })).toEqual({ type: 'gitOp', id: 'x', op: { kind: 'resolveSide', path: 'a.txt', side: 'theirs' } });
    expect(op({ kind: 'resolveSide', path: 'a.txt', side: 'both' })).toBeUndefined();
    expect(op({ kind: 'resolveSide', path: '/etc/passwd', side: 'ours' })).toBeUndefined();
  });

  it('levelsFor moda göre seçer', () => {
    const files = [at('x', 0.5)];
    expect(levelsFor('recency', files, NOW).get('x')).toBe(5);
    expect(levelsFor('churn', files, NOW).get('x')).toBe(1);
  });
});

describe('recentCommitsForFile', () => {
  it('yeniden adlandırmayı geriye doğru takip eder ve commit başına yolu verir', () => {
    const commits = [
      commit('c4', [{ path: 'src/new.ts', added: 1, deleted: 0 }]),
      commit('c3', [{ path: 'src/new.ts', oldPath: 'src/old.ts', added: 0, deleted: 0 }]),
      commit('c2', [{ path: 'other.ts', added: 1, deleted: 0 }]),
      commit('c1', [{ path: 'src/old.ts', added: 5, deleted: 0 }]),
    ];
    const r = recentCommitsForFile('src/new.ts', commits);
    expect(r.map((x) => `${x.commit.hash}:${x.path}`)).toEqual(['c4:src/new.ts', 'c3:src/new.ts', 'c1:src/old.ts']);
    expect(recentCommitsForFile('src/new.ts', commits, 2)).toHaveLength(2);
  });
});

describe('Explorer rozeti', () => {
  it('en sıcak %10 ●●, sonraki %20 ●, değişmeyenlere rozet yok', () => {
    const files = [...Array.from({ length: 20 }, (_, i) => file(`f${i}`, i + 1)), file('cold', 0)];
    const tiers = computeHeatTiers(files);
    expect([...tiers.values()].filter((t) => t === 2)).toHaveLength(2);
    expect([...tiers.values()].filter((t) => t === 1)).toHaveLength(4);
    expect(tiers.get('f19')).toBe(2);
    expect(tiers.has('cold')).toBe(false);
    expect(heatBadge(2, 7).badge).toBe('●●');
    expect(heatBadge(1, 3).badge).toBe('●');
    expect(heatBadge(2, 7).badge.length).toBeLessThanOrEqual(2);
  });
});

describe('webview mesaj doğrulama', () => {
  it('geçerli mesajları kabul eder, bozukları ve tehlikeli yolları reddeder', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseWebviewMessage({ type: 'setRange', range: '7d' })).toEqual({ type: 'setRange', range: '7d' });
    expect(parseWebviewMessage({ type: 'setRange', range: '1y' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'openFile', path: 'src/a.ts' })).toEqual({ type: 'openFile', path: 'src/a.ts' });
    expect(parseWebviewMessage({ type: 'openFile', path: '../etc/passwd' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'openDiff', path: 'a.ts', hash: 'zz' })).toBeUndefined();
    expect(parseWebviewMessage('ready')).toBeUndefined();
    expect(isSafeRelPath('C:/x')).toBe(false);
    expect(isSafeRelPath('/abs')).toBe(false);
  });
  it('ignore ayarını temizler', () => {
    expect(sanitizeIgnore(['  a/** ', '', 3, null, 'b'])).toEqual(['a/**', 'b']);
    expect(sanitizeIgnore('x')).toEqual([]);
  });
});
