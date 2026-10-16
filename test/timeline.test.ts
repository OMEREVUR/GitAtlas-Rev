import { describe, expect, it } from 'vitest';
import { computeFileStats } from '../src/model/aggregate';
import { buildTimeline, timelineFrame, timelineSteps } from '../src/model/timeline';
import type { CommitFileChange, CommitSummary, GitRef, RepoSnapshot, TimelineData } from '../src/types';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1, 12);

let seq = 0;
function commit(day: number, files: CommitFileChange[], opts: { parents?: string[]; message?: string } = {}): CommitSummary {
  seq++;
  const hash = seq.toString(16).padStart(40, '0');
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: opts.parents ?? [],
    author: 'Ayse',
    email: 'ayse@example.com',
    date: T0 + day * DAY,
    message: opts.message ?? `commit ${seq}`,
    files,
  };
}

const ch = (path: string, oldPath?: string): CommitFileChange =>
  oldPath === undefined ? { path, added: 1, deleted: 0 } : { path, oldPath, added: 0, deleted: 0 };

function tag(name: string, hash: string): GitRef {
  return { name, fullName: `refs/tags/${name}`, kind: 'tag', hash, isHead: false, date: 0, subject: '', author: '' };
}

// En yeniden en eskiye.
const commits: CommitSummary[] = [
  commit(30, [ch('src/new.ts'), ch('src/b.ts')]),
  commit(25, [], { parents: ['p1', 'p2'], message: 'Merge branch x' }),
  commit(20, [ch('src/new.ts', 'src/old.ts')]),
  commit(14, [ch('src/b.ts'), ch('node_modules/x.js')]),
  commit(10, [ch('src/old.ts')]),
  commit(3, [ch('src/old.ts'), ch('gone.ts')]),
  commit(0, [ch('README.md')], { message: 'ilk' }),
];
const snapshot: RepoSnapshot = {
  root: '/repo',
  headHash: commits[0]!.hash,
  generatedAt: T0 + 30 * DAY,
  commits,
  lineCounts: { 'src/new.ts': 10, 'src/b.ts': 5, 'README.md': 2, 'node_modules/x.js': 1 },
};
const files = computeFileStats(snapshot, 'all', ['**/node_modules/**'], T0 + 30 * DAY);

describe('buildTimeline', () => {
  const t = buildTimeline(snapshot, files);
  const idx = (p: string): number => t.paths.indexOf(p);

  it('paths = haritadaki dosyalar; start/end', () => {
    expect([...t.paths].sort()).toEqual(['README.md', 'src/b.ts', 'src/new.ts']);
    expect(t.start).toBe(T0);
    expect(t.end).toBe(T0 + 30 * DAY);
  });

  it('event\'ler eskiden yeniye; dosyasız commit\'ler de var; rename bugünkü ada sayılır', () => {
    expect(t.events).toHaveLength(7);
    expect(t.events.map((e) => e.date)).toEqual([0, 3, 10, 14, 20, 25, 30].map((d) => T0 + d * DAY));
    expect(t.events[0]!.files).toEqual([idx('README.md')]);
    expect(t.events[1]!.files).toEqual([idx('src/new.ts')]); // eski adla (src/old.ts), gone.ts haritada yok
    expect(t.events[3]!.files).toEqual([idx('src/b.ts')]); // node_modules ignore
    expect(t.events[5]!.files).toEqual([]); // merge
    expect(t.events[6]!.files).toEqual([idx('src/new.ts'), idx('src/b.ts')].sort((a, b) => a - b));
  });

  it('firstSeen = rename zinciri dahil en eski commit', () => {
    expect(t.firstSeen[idx('src/new.ts')]).toBe(T0 + 3 * DAY);
    expect(t.firstSeen[idx('src/b.ts')]).toBe(T0 + 14 * DAY);
    expect(t.firstSeen[idx('README.md')]).toBe(T0);
  });

  it('marks: etiket yoksa ilk commit + merge\'ler', () => {
    expect(t.marks).toEqual([
      { date: T0, label: 'İlk commit: ilk', kind: 'first' },
      { date: T0 + 25 * DAY, label: 'Merge branch x', kind: 'merge' },
    ]);
  });

  it('marks: etiket varsa merge yok; snapshot dışı etiket atlanır; en çok 20', () => {
    const refs = [tag('v1', commits[3]!.hash), tag('dış', 'f'.repeat(40))];
    expect(buildTimeline(snapshot, files, refs).marks).toEqual([
      { date: T0, label: 'İlk commit: ilk', kind: 'first' },
      { date: T0 + 14 * DAY, label: 'v1', kind: 'tag' },
    ]);
    const many = Array.from({ length: 30 }, (_, i) => tag(`t${i}`, commits[i % commits.length]!.hash));
    expect(buildTimeline(snapshot, files, many).marks.filter((m) => m.kind === 'tag')).toHaveLength(20);
  });

  it('en çok 8 merge, en yeniler', () => {
    const merges = Array.from({ length: 12 }, (_, i) => commit(100 - i, [], { parents: ['a', 'b'], message: `m${i}` }));
    const snap = { ...snapshot, commits: [...merges, ...commits] };
    const marks = buildTimeline(snap, files).marks.filter((m) => m.kind === 'merge');
    expect(marks).toHaveLength(8);
    expect(marks[marks.length - 1]!.label).toBe('m0');
  });

  it('boş snapshot', () => {
    const empty = buildTimeline({ ...snapshot, commits: [], lineCounts: {} }, []);
    expect(empty).toEqual({ start: 0, end: 0, paths: [], firstSeen: [], events: [], marks: [] });
    expect(timelineSteps(empty)).toEqual([0]);
  });
});

describe('timelineFrame', () => {
  const t = buildTimeline(snapshot, files);

  it('pencere (at − 7g, at]: alt sınır hariç, üst sınır dahil', () => {
    const f = timelineFrame(t, T0 + 10 * DAY);
    // 3. gün (tam 7 gün önce) hariç, 10. gün dahil
    expect(f.windowCommits).toBe(1);
    expect([...f.changes]).toEqual([['src/new.ts', 1]]);

    const f2 = timelineFrame(t, T0 + 10 * DAY + 1);
    expect(f2.windowCommits).toBe(1);
    const f3 = timelineFrame(t, T0 + 10 * DAY - 1);
    expect(f3.windowCommits).toBe(1); // yalnızca 3. gün
  });

  it('pencere genişliği ve sayımlar', () => {
    const f = timelineFrame(t, T0 + 30 * DAY, 30);
    expect(f.windowCommits).toBe(6);
    expect(f.changes.get('src/new.ts')).toBe(4);
    expect(f.changes.get('src/b.ts')).toBe(2);
    expect(f.changes.has('README.md')).toBe(false);
  });

  it('missing = henüz var olmayan dosyalar', () => {
    expect([...timelineFrame(t, T0 + 1 * DAY).missing].sort()).toEqual(['src/b.ts', 'src/new.ts']);
    expect([...timelineFrame(t, T0 + 3 * DAY).missing]).toEqual(['src/b.ts']);
    expect(timelineFrame(t, T0 + 14 * DAY).missing.size).toBe(0);
    expect(timelineFrame(t, T0 - DAY).missing.size).toBe(3);
  });

  it('10.000 event\'te < 5 ms', () => {
    const n = 10_000;
    const paths = Array.from({ length: 2000 }, (_, i) => `f${i}.ts`);
    const big: TimelineData = {
      start: T0,
      end: T0 + (n - 1) * 3_600_000,
      paths,
      firstSeen: paths.map((_, i) => T0 + i * 3_600_000),
      events: Array.from({ length: n }, (_, i) => ({
        date: T0 + i * 3_600_000,
        hash: String(i),
        message: '',
        author: 'a',
        files: [i % 2000, (i * 7) % 2000],
      })),
      marks: [],
    };
    timelineFrame(big, T0 + 5000 * 3_600_000); // ısınma
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) timelineFrame(big, T0 + (1000 + k * 800) * 3_600_000);
    expect((performance.now() - t0) / 10).toBeLessThan(5);
    expect(timelineFrame(big, big.end).windowCommits).toBe(168);
  });
});

describe('timelineSteps', () => {
  const data = (start: number, end: number): TimelineData => ({ start, end, paths: [], firstSeen: [], events: [], marks: [] });

  it('≤ 120 gün → günlük, son adım end', () => {
    const s = timelineSteps(data(T0, T0 + 30 * DAY + 5));
    expect(s[0]).toBe(T0);
    expect(s[1]! - s[0]!).toBe(DAY);
    expect(s).toHaveLength(32);
    expect(s[s.length - 1]).toBe(T0 + 30 * DAY + 5);
    expect(timelineSteps(data(T0, T0 + 120 * DAY))).toHaveLength(121);
  });

  it('≤ 3 yıl → haftalık', () => {
    const s = timelineSteps(data(T0, T0 + 121 * DAY));
    expect(s[1]! - s[0]!).toBe(7 * DAY);
    expect(s).toHaveLength(19); // 0..119 → 18 adım + end
    expect(s[s.length - 1]).toBe(T0 + 121 * DAY);
  });

  it('> 3 yıl → aylık, artan, son adım end', () => {
    const end = T0 + 4 * 365 * DAY;
    const s = timelineSteps(data(T0, end));
    expect(s.length).toBeGreaterThanOrEqual(48);
    expect(s.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
    expect(s[s.length - 1]).toBe(end);
    const gap = s[1]! - s[0]!;
    expect(gap).toBeGreaterThanOrEqual(28 * DAY);
    expect(gap).toBeLessThanOrEqual(31 * DAY + 3_600_000);
  });

  it('başlangıç = bitiş → tek adım', () => {
    expect(timelineSteps(data(T0, T0))).toEqual([T0]);
  });
});
