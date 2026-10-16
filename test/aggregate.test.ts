import { describe, expect, it } from 'vitest';
import { computeFileStats } from '../src/model/aggregate';
import type { CommitFileChange, CommitSummary, FileStat, RepoSnapshot } from '../src/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 16, 12);

let seq = 0;
function commit(daysAgo: number, author: string, files: CommitFileChange[]): CommitSummary {
  seq++;
  const hash = seq.toString(16).padStart(40, '0');
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    author,
    email: `${author.toLowerCase()}@example.com`,
    date: NOW - daysAgo * DAY,
    message: `commit ${seq}`,
    files,
  };
}

function ch(path: string, added = 1, deleted = 0, oldPath?: string): CommitFileChange {
  return oldPath === undefined ? { path, added, deleted } : { path, oldPath, added, deleted };
}

// En yeniden en eskiye.
const commits: CommitSummary[] = [
  commit(1, 'Ayse', [ch('src/new.ts', 5, 1), ch('src/b.ts', 2, 2)]),
  commit(3, 'Mehmet', [ch('src/new.ts', 1, 0), ch('node_modules/x/index.js', 10, 0)]),
  commit(5, 'Mehmet', [ch('src/new.ts', 3, 3)]),
  commit(10, 'Zeynep', [ch('src/new.ts', 0, 0, 'src/mid.ts')]), // mid → new
  commit(15, 'Ayse', [ch('src/mid.ts', 4, 0), ch('assets/logo.png', 0, 0)]),
  commit(20, 'Zeynep', [ch('src/mid.ts', 0, 0, 'src/old.ts')]), // old → mid
  commit(40, 'Zeynep', [ch('src/old.ts', 7, 0), ch('src/b.ts', 1, 0), ch('src/gone.ts', 3, 0)]),
  commit(60, 'Ayse', [ch('src/old.ts', 20, 0), ch('package-lock.json', 100, 0)]),
];

const snapshot: RepoSnapshot = {
  root: '/repo',
  headHash: commits[0]!.hash,
  generatedAt: NOW,
  commits,
  // assets/logo.png (binary) ve src/gone.ts (silinmiş) haritada yok.
  lineCounts: {
    'src/new.ts': 40,
    'src/b.ts': 12,
    'src/untouched.ts': 7,
    'node_modules/x/index.js': 10,
    'package-lock.json': 500,
  },
};

const IGNORE = ['**/node_modules/**', '**/package-lock.json'];

function byPath(stats: FileStat[]): Map<string, FileStat> {
  return new Map(stats.map((s) => [s.path, s]));
}

describe('computeFileStats', () => {
  it('dosya kümesi lineCounts − ignore; binary ve silinmiş dosyalar yok', () => {
    const stats = computeFileStats(snapshot, 'all', IGNORE, NOW);
    expect(stats.map((s) => s.path).sort()).toEqual(['src/b.ts', 'src/new.ts', 'src/untouched.ts']);
  });

  it('ignore boşsa tüm lineCounts dosyaları listelenir', () => {
    const stats = computeFileStats(snapshot, 'all', [], NOW);
    expect(stats).toHaveLength(5);
  });

  it('yeniden adlandırma zinciri tek kayıtta toplanır (tümü)', () => {
    const s = byPath(computeFileStats(snapshot, 'all', IGNORE, NOW)).get('src/new.ts')!;
    expect(s.changes).toBe(8);
    expect(s.added).toBe(5 + 1 + 3 + 0 + 4 + 0 + 7 + 20);
    expect(s.deleted).toBe(1 + 0 + 3);
    expect(s.lines).toBe(40);
    expect(s.lastModified).toBe(NOW - 1 * DAY);
  });

  it('7g ve 30g aralıkları', () => {
    const s7 = byPath(computeFileStats(snapshot, '7d', IGNORE, NOW));
    expect(s7.get('src/new.ts')).toMatchObject({ changes: 3, added: 9, deleted: 4 });
    expect(s7.get('src/b.ts')).toMatchObject({ changes: 1, added: 2, deleted: 2 });

    const s30 = byPath(computeFileStats(snapshot, '30d', IGNORE, NOW));
    expect(s30.get('src/new.ts')).toMatchObject({ changes: 6, added: 13, deleted: 4 });
    expect(s30.get('src/b.ts')).toMatchObject({ changes: 1 });
  });

  it('lastModified aralıktan bağımsız tüm geçmişten gelir', () => {
    const s7 = byPath(computeFileStats(snapshot, '7d', IGNORE, NOW + 30 * DAY));
    const b = s7.get('src/b.ts')!;
    expect(b.changes).toBe(0);
    expect(b.lastModified).toBe(NOW - 1 * DAY);
  });

  it('yazarlar aralıktaki commit sayısına göre çoktan aza', () => {
    const all = byPath(computeFileStats(snapshot, 'all', IGNORE, NOW)).get('src/new.ts')!;
    // Ayse 3, Zeynep 3, Mehmet 2 → eşitlikte ada göre.
    expect(all.authors).toEqual(['Ayse', 'Zeynep', 'Mehmet']);
    const r7 = byPath(computeFileStats(snapshot, '7d', IGNORE, NOW)).get('src/new.ts')!;
    expect(r7.authors).toEqual(['Mehmet', 'Ayse']);
  });

  it('hiç dokunulmamış dosya 0 değişiklikle listede', () => {
    const u = byPath(computeFileStats(snapshot, 'all', IGNORE, NOW)).get('src/untouched.ts')!;
    expect(u).toEqual({
      path: 'src/untouched.ts',
      lines: 7,
      changes: 0,
      added: 0,
      deleted: 0,
      lastModified: 0,
      authors: [],
    });
  });

  it('eski ad sonradan yeni bir dosyaya verilirse geçmiş karışmaz', () => {
    const snap: RepoSnapshot = {
      ...snapshot,
      commits: [
        commit(1, 'Ayse', [ch('a.ts', 2, 0)]), // yeni a.ts
        commit(5, 'Ayse', [ch('b.ts', 0, 0, 'a.ts')]), // eski a.ts → b.ts
        commit(9, 'Mehmet', [ch('a.ts', 9, 0)]), // eski a.ts (artık b.ts)
      ],
      lineCounts: { 'a.ts': 2, 'b.ts': 9 },
    };
    const s = byPath(computeFileStats(snap, 'all', [], NOW));
    expect(s.get('a.ts')).toMatchObject({ changes: 1, added: 2 });
    expect(s.get('b.ts')).toMatchObject({ changes: 2, added: 9, authors: ['Ayse', 'Mehmet'] });
  });
});
