import { describe, expect, it } from 'vitest';
import { computeContrib, moduleResolver } from '../src/model/contrib';
import type { CommitFileChange, CommitSummary, FileStat } from '../src/types';

const DAY = 24 * 60 * 60 * 1000;
// Yerel saatle Perşembe 15 Ekim 2026, 12:00 → haftanın pazartesisi 12 Ekim.
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime();

let seq = 0;
function commit(
  daysAgo: number,
  author: [string, string],
  files: CommitFileChange[],
  parents: string[] = ['p'],
): CommitSummary {
  seq++;
  const hash = seq.toString(16).padStart(40, '0');
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    author: author[0],
    email: author[1],
    date: NOW - daysAgo * DAY,
    message: `c${seq}`,
    files,
  };
}
const ch = (path: string, added: number, deleted = 0, oldPath?: string): CommitFileChange =>
  oldPath === undefined ? { path, added, deleted } : { path, oldPath, added, deleted };
const file = (path: string, lines = 10): FileStat => ({
  path,
  lines,
  changes: 0,
  added: 0,
  deleted: 0,
  lastModified: 0,
  authors: [],
});

const AYSE: [string, string] = ['Ayse Yilmaz', 'ayse@example.com'];
const AYSE_ALT: [string, string] = ['ayse', 'Ayse@Example.com']; // aynı kişi, farklı ad ve büyük harf
const MEHMET: [string, string] = ['Mehmet Demir', 'mehmet@example.com'];
const ZEYNEP: [string, string] = ['Zeynep Kaya', 'zeynep@example.com'];

describe('moduleResolver', () => {
  it('ilk klasör; kök dosyalar ""', () => {
    const m = moduleResolver(['a/x.ts', 'b/y.ts', 'README.md', 'a/deep/z.ts']);
    expect(m('a/deep/z.ts')).toBe('a');
    expect(m('README.md')).toBe('');
    expect(m('b/y.ts')).toBe('b');
  });

  it('tek üst klasör %60\'tan fazlaysa alt klasörleri modül olur', () => {
    const paths = ['src/git/a.ts', 'src/git/b.ts', 'src/model/c.ts', 'src/index.ts', 'docs/x.md', 'README.md'];
    // src: 4/6 = %66
    const m = moduleResolver(paths);
    expect(m('src/git/a.ts')).toBe('src/git');
    expect(m('src/model/c.ts')).toBe('src/model');
    expect(m('src/index.ts')).toBe('src');
    expect(m('docs/x.md')).toBe('docs');
    expect(m('README.md')).toBe('');
  });

  it('tam %60 yetmez', () => {
    const m = moduleResolver(['src/a/1', 'src/b/2', 'src/c/3', 'x/4', 'y/5']);
    expect(m('src/a/1')).toBe('src');
  });
});

describe('computeContrib', () => {
  const files = [
    file('src/git/runner.ts', 50),
    file('src/git/log.ts', 40),
    file('src/model/repoModel.ts', 80),
    file('src/index.ts', 5),
    file('docs/guide.md', 20),
    file('README.md', 3),
  ];
  // En yeniden en eskiye.
  const commits: CommitSummary[] = [
    commit(1, AYSE, [ch('src/git/runner.ts', 10, 2)]),
    commit(2, MEHMET, [], ['p1', 'p2']), // merge: commit sayılır, satır yok
    commit(3, AYSE_ALT, [ch('src/git/log.ts', 20), ch('package-lock.json', 999)]),
    commit(5, MEHMET, [ch('src/model/repoModel.ts', 5, 5), ch('src/git/runner.ts', 1)]),
    commit(9, ZEYNEP, [ch('docs/guide.md', 7)]),
    commit(12, AYSE, [ch('src/model/repoModel.ts', 0, 0, 'src/model/model.ts')]), // rename
    commit(20, MEHMET, [ch('src/model/model.ts', 30)]), // eski adla
    commit(40, ZEYNEP, [ch('src/git/runner.ts', 100)]), // 30g dışında
    commit(60, ZEYNEP, [ch('src/model/model.ts', 50), ch('src/index.ts', 5)]),
  ];

  it('mailmap\'li e-posta (küçük harf) aynı kişiyi birleştirir; ad en sık görülen', () => {
    const d = computeContrib(commits, files, '30d', NOW);
    const ayse = d.authors.find((a) => a.key === 'ayse@example.com')!;
    expect(d.authors.filter((a) => a.key.startsWith('ayse'))).toHaveLength(1);
    expect(ayse.commits).toBe(3);
    expect(ayse.name).toBe('Ayse Yilmaz');
    expect(ayse.added).toBe(30);
    expect(ayse.deleted).toBe(2);
    expect(ayse.topModule).toBe('src/git');
  });

  it('aralık, merge sayımı, yazar sırası', () => {
    const d = computeContrib(commits, files, '30d', NOW);
    expect(d.range).toBe('30d');
    expect(d.since).toBe(NOW - 30 * DAY);
    expect(d.until).toBe(NOW);
    // Commit sayısı eşitse değişen satır çok olan önce (Mehmet 41 > Ayse 32).
    expect(d.authors.map((a) => [a.key, a.commits])).toEqual([
      ['mehmet@example.com', 3],
      ['ayse@example.com', 3],
      ['zeynep@example.com', 1],
    ]);
    const mehmet = d.authors[0]!;
    expect(mehmet.added + mehmet.deleted).toBe(41); // merge'ün satırı yok; eski adla yapılan 30 satır dahil
    expect(mehmet.topModule).toBe('src/model');

    const d7 = computeContrib(commits, files, '7d', NOW);
    expect(d7.authors.map((a) => a.key)).toEqual(['ayse@example.com', 'mehmet@example.com']);

    const all = computeContrib(commits, files, 'all', NOW);
    expect(all.since).toBe(NOW - 60 * DAY);
    expect(all.authors.find((a) => a.key === 'zeynep@example.com')!.commits).toBe(3);
  });

  it('modüller: total, paylar çoktan aza, rename zinciri, yalnızca haritadaki dosyalar', () => {
    const d = computeContrib(commits, files, '30d', NOW);
    expect(d.modules).toEqual([
      {
        module: 'src/model',
        total: 40,
        shares: [{ author: 'mehmet@example.com', lines: 40 }],
      },
      {
        module: 'src/git',
        total: 33,
        shares: [
          { author: 'ayse@example.com', lines: 32 },
          { author: 'mehmet@example.com', lines: 1 },
        ],
      },
      { module: 'docs', total: 7, shares: [{ author: 'zeynep@example.com', lines: 7 }] },
    ]);
    // "tek kişiye bağlı" eşiği (≥%80) için veri: src/git'te Ayse 32/33.
    const git = d.modules.find((m) => m.module === 'src/git')!;
    expect(git.shares[0]!.lines / git.total).toBeGreaterThanOrEqual(0.8);
  });

  it('total 0 olan modüller atılır, en çok 12 modül', () => {
    const many = Array.from({ length: 15 }, (_, i) => file(`m${i}/f.ts`));
    const cs = many.map((f, i) => commit(1, AYSE, [ch(f.path, i + 1)]));
    cs.push(commit(2, AYSE, [ch('zero/f.ts', 0, 0)]));
    const d = computeContrib(cs, [...many, file('zero/f.ts')], '7d', NOW);
    expect(d.modules).toHaveLength(12);
    expect(d.modules[0]!.module).toBe('m14');
    expect(d.modules.some((m) => m.module === 'zero')).toBe(false);
  });

  it('ritim: 7d/30d → 4 hafta, all → 12; pazartesi 00:00 yerel; gün indeksi 0=Pzt', () => {
    const d = computeContrib(commits, files, '30d', NOW);
    expect(d.weeks).toHaveLength(4);
    const last = new Date(d.weeks[3]!);
    expect([last.getFullYear(), last.getMonth(), last.getDate(), last.getDay(), last.getHours()]).toEqual([2026, 9, 12, 1, 0]);
    for (let i = 1; i < 4; i++) {
      const prev = new Date(d.weeks[i - 1]!);
      const cur = new Date(d.weeks[i]!);
      expect(cur.getDay()).toBe(1);
      expect(Math.round((cur.getTime() - prev.getTime()) / DAY)).toBe(7);
    }
    expect(computeContrib(commits, files, 'all', NOW).weeks).toHaveLength(12);
    expect(computeContrib(commits, files, '7d', NOW).weeks).toHaveLength(4);

    // NOW = Perşembe. 1g önce = Çarşamba (2), 2g = Salı (1), 3g = Pazartesi (0), 5g = önceki Cumartesi (5)
    const all = d.rhythm['']!;
    expect(all).toHaveLength(4);
    expect(all[3]).toEqual([1, 1, 1, 0, 0, 0, 0]);
    expect(all[2]![5]).toBe(1); // 5g önce
    expect(all[2]![1]).toBe(1); // 9g önce = Salı
    expect(all[1]![5]).toBe(1); // 12g önce = Cumartesi
    // 20g önce = Cuma, üç hafta önceki pazartesiden önce mi? 12 Eki − 21 = 21 Eyl; 25 Eyl Cuma → hafta 0
    expect(all[0]![4]).toBe(1);
    const sum = (g: number[][]): number => g.flat().reduce((s, n) => s + n, 0);
    expect(sum(all)).toBe(7);
    expect(sum(d.rhythm['mehmet@example.com']!)).toBe(3); // merge dahil
    expect(sum(d.rhythm['ayse@example.com']!)).toBe(3);
    expect(d.rhythm['zeynep@example.com']).toBeDefined();
  });

  it('experts: en sıcak dosyalar, tüm geçmişte en çok satır değiştiren', () => {
    const d = computeContrib(commits, files, '30d', NOW);
    expect(d.experts.map((e) => e.path)).toEqual([
      'src/model/repoModel.ts', // 3 değişiklik (eski adla + rename + yeni adla)
      'src/git/runner.ts', // 2 değişiklik
      'src/git/log.ts', // 1 değişiklik, 40 satır
      'docs/guide.md', // 1 değişiklik, 20 satır
    ]);
    const runner = d.experts.find((e) => e.path === 'src/git/runner.ts')!;
    // Tüm geçmiş: Zeynep 100, Ayse 12, Mehmet 1
    expect(runner.author).toBe('zeynep@example.com');
    expect(runner.share).toBeCloseTo(100 / 113);
    const model = d.experts.find((e) => e.path === 'src/model/repoModel.ts')!;
    // Zeynep 50 (eski ad), Mehmet 30 + 10
    expect(model.author).toBe('zeynep@example.com');
    expect(model.share).toBeCloseTo(50 / 90);
  });

  it('experts: eşitlikte satır sayısı büyük olan önce; en çok 8', () => {
    const fs = Array.from({ length: 10 }, (_, i) => file(`f${i}.ts`, i));
    const cs = fs.map((f) => commit(1, AYSE, [ch(f.path, 1)]));
    const d = computeContrib(cs, fs, '7d', NOW);
    expect(d.experts.map((e) => e.path)).toEqual(['f9.ts', 'f8.ts', 'f7.ts', 'f6.ts', 'f5.ts', 'f4.ts', 'f3.ts', 'f2.ts']);
    expect(d.experts[0]).toEqual({ path: 'f9.ts', author: 'ayse@example.com', share: 1 });
  });

  it('boş girdi', () => {
    const d = computeContrib([], [], 'all', NOW);
    expect(d.authors).toEqual([]);
    expect(d.modules).toEqual([]);
    expect(d.experts).toEqual([]);
    expect(d.weeks).toHaveLength(12);
    expect(d.rhythm['']!.flat().every((n) => n === 0)).toBe(true);
  });
});
