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

import { heatLevels } from '../src/webview/heat';
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
