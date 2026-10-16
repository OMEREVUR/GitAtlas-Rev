import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../src/model/graphLayout';
import type { CommitSummary, GraphLayout } from '../src/types';

function c(hash: string, ...parents: string[]): CommitSummary {
  return { hash, shortHash: hash, parents, author: 'a', email: 'a@x', date: 0, message: hash, files: [] };
}

type Point = { row: number; lane: number };
const key = (p: Point): string => `${p.row}:${p.lane}`;

/**
 * Genel doğrulayıcı: GraphEdge.points sözleşmesi, uç noktalar, şerit çakışmaması.
 * Her kenar için beklenen (çocuk → parent) eşlemesini de kontrol eder.
 */
function validate(commits: CommitSummary[], layout: GraphLayout): void {
  const { rows, edges, laneCount } = layout;
  expect(rows.map((r) => r.hash)).toEqual(commits.map((x) => x.hash));
  const rowOf = new Map(commits.map((x, i) => [x.hash, i]));
  const nodes = new Set(rows.map((r, i) => key({ row: i, lane: r.lane })));
  const bottom = commits.length;

  for (const r of rows) {
    expect(r.lane).toBeGreaterThanOrEqual(0);
    expect(r.lane).toBeLessThan(laneCount);
    expect(r.color).toBeGreaterThanOrEqual(0);
    expect(r.color).toBeLessThan(5);
  }
  expect(laneCount).toBe(rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.lane), ...edges.flatMap((e) => e.points.map((p) => p.lane))) + 1);

  // Her (çocuk, parent) çifti için tam bir kenar.
  const expected: string[] = [];
  commits.forEach((x, i) => {
    for (const p of x.parents) {
      const pr = rowOf.get(p);
      expected.push(`${i}:${rows[i]!.lane}->${pr === undefined ? `${bottom}:*` : `${pr}:${rows[pr]!.lane}`}`);
    }
  });
  const actual = edges.map((e) => {
    const first = e.points[0]!;
    const last = e.points[e.points.length - 1]!;
    return `${key(first)}->${last.row === bottom ? `${bottom}:*` : key(last)}`;
  });
  expect(actual.sort()).toEqual(expected.sort());

  // Nokta sözleşmesi + segment listesi.
  interface Seg {
    edge: number;
    top: Point;
    bottom: Point;
  }
  const segsByInterval = new Map<number, Seg[]>();
  edges.forEach((e, ei) => {
    expect(e.points.length).toBeGreaterThanOrEqual(2);
    expect(e.color).toBeGreaterThanOrEqual(0);
    expect(e.color).toBeLessThan(5);
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]!;
      const b = e.points[i]!;
      expect(b.row, `kenar ${ei} aşağı doğru ilerler`).toBeGreaterThan(a.row);
      if (a.lane !== b.lane) expect(b.row - a.row, `kenar ${ei}: şerit değişimi tek satırda`).toBe(1);
      // Düz parça başka commit düğümünün üstünden geçmez.
      for (let r = a.row + 1; r < b.row; r++) {
        expect(nodes.has(key({ row: r, lane: a.lane })), `kenar ${ei} ${r}:${a.lane} düğümünden geçiyor`).toBe(false);
      }
      // Ara noktalar düğüm üzerinde olmaz.
      if (i < e.points.length - 1) expect(nodes.has(key(b)), `kenar ${ei} ara noktası düğümde`).toBe(false);
      for (let r = a.row; r < b.row; r++) {
        const top = r === a.row ? a : { row: r, lane: a.lane };
        const bot = r + 1 === b.row ? b : { row: r + 1, lane: a.lane };
        const list = segsByInterval.get(r) ?? [];
        list.push({ edge: ei, top, bottom: bot });
        segsByInterval.set(r, list);
      }
    }
  });

  // Aynı aralıkta iki kenar aynı şeridin aynı ucunu yalnızca bir düğümde ya da
  // aynı yolu paylaşan (aynı parent'a giden) demetlerde paylaşabilir.
  const tail = (ei: number, from: Point): string => {
    const pts = edges[ei]!.points;
    const idx = pts.findIndex((p) => p.row >= from.row);
    return JSON.stringify(pts.slice(idx).filter((p) => p.row > from.row));
  };
  for (const [, segs] of segsByInterval) {
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i]!;
        const t = segs[j]!;
        for (const end of ['top', 'bottom'] as const) {
          if (s[end].lane !== t[end].lane) continue;
          if (nodes.has(key(s[end]))) continue;
          expect(tail(s.edge, s[end]), `kenar ${s.edge} ve ${t.edge} ${key(s[end])} noktasında çakışıyor`).toBe(
            tail(t.edge, t[end]),
          );
        }
        // Düz paralel çakışma: ikisi de aynı şeritte dikey ilerliyorsa aynı yoldadırlar.
        if (s.top.lane === s.bottom.lane && t.top.lane === t.bottom.lane && s.top.lane === t.top.lane) {
          expect(tail(s.edge, s.top)).toBe(tail(t.edge, t.top));
        }
      }
    }
  }
}

function run(commits: CommitSummary[]): GraphLayout {
  const layout = layoutGraph(commits);
  validate(commits, layout);
  return layout;
}

describe('layoutGraph', () => {
  it('boş liste', () => {
    expect(run([])).toEqual({ rows: [], edges: [], laneCount: 0 });
  });

  it('doğrusal geçmiş tek şerit, tek renk', () => {
    const l = run([c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')]);
    expect(l.laneCount).toBe(1);
    expect(new Set(l.rows.map((r) => r.lane))).toEqual(new Set([0]));
    expect(new Set(l.rows.map((r) => r.color)).size).toBe(1);
    expect(l.edges).toHaveLength(3);
    expect(l.edges[0]!.points).toEqual([
      { row: 0, lane: 0 },
      { row: 1, lane: 0 },
    ]);
  });

  it('tek merge', () => {
    //  M
    //  |\
    //  b f2
    //  | f1
    //  |/
    //  a
    const l = run([c('M', 'b', 'f2'), c('f2', 'f1'), c('b', 'a'), c('f1', 'a'), c('a')]);
    expect(l.rows[0]!.isMerge).toBe(true);
    expect(l.rows.filter((r) => r.isMerge)).toHaveLength(1);
    expect(l.laneCount).toBe(2);
    expect(l.rows.find((r) => r.hash === 'a')!.lane).toBe(0);
    expect(l.rows.find((r) => r.hash === 'b')!.lane).toBe(0);
    expect(l.rows.find((r) => r.hash === 'f2')!.lane).toBe(1);
    // branch çizgisi boyunca renk aynı
    const f2 = l.rows.find((r) => r.hash === 'f2')!;
    const f1 = l.rows.find((r) => r.hash === 'f1')!;
    expect(f1.color).toBe(f2.color);
    expect(f2.color).not.toBe(l.rows[0]!.color);
  });

  it('iç içe merge\'ler', () => {
    const l = run([
      c('M2', 'm1', 'x2'),
      c('x2', 'M1x'),
      c('m1', 'M1'),
      c('M1x', 'y1'),
      c('M1', 'base2', 'z1'),
      c('z1', 'base'),
      c('y1', 'base'),
      c('base2', 'base'),
      c('base'),
    ]);
    expect(l.rows.filter((r) => r.isMerge).map((r) => r.hash)).toEqual(['M2', 'M1']);
    expect(l.laneCount).toBeLessThanOrEqual(3);
  });

  it('merge\'ün ikinci parent\'ı bir sonraki satırda', () => {
    run([c('M', 'a', 'f'), c('f', 'a'), c('a')]);
    run([c('M', 'a', 'f'), c('x', 'f'), c('f', 'a'), c('a')]);
  });

  it('octopus merge (3 parent)', () => {
    const l = run([c('O', 'a', 'b', 'c'), c('c', 'r'), c('b', 'r'), c('a', 'r'), c('r')]);
    expect(l.rows[0]!.isMerge).toBe(true);
    expect(l.laneCount).toBe(3);
    expect(new Set(l.rows.slice(1, 4).map((r) => r.lane)).size).toBe(3);
  });

  it('aynı parent\'a iki branch', () => {
    const l = run([c('x', 'p'), c('y', 'p'), c('p', 'q'), c('q')]);
    expect(l.rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
    expect(l.laneCount).toBe(2);
    // y'nin kenarı p satırında şerit 0'a döner
    const yEdge = l.edges.find((e) => e.points[0]!.row === 1)!;
    expect(yEdge.points).toEqual([
      { row: 1, lane: 1 },
      { row: 2, lane: 0 },
    ]);
  });

  it('merge, başka bir branch\'in zaten beklediği parent\'a bağlanır', () => {
    // M'nin ikinci parent'ı p'yi y de bekliyor.
    run([c('y', 'p'), c('M', 'a', 'p'), c('a', 'q'), c('p', 'q'), c('q')]);
    run([c('y', 'p'), c('z', 'p'), c('M', 'a', 'p'), c('p', 'a'), c('a')]);
  });

  it('limit dışı parent: kenar alt kenara (row = rows.length) uzar', () => {
    const l = run([c('M', 'b', 'gone2'), c('b', 'gone1')]);
    const bottoms = l.edges.map((e) => e.points[e.points.length - 1]!).filter((p) => p.row === 2);
    expect(bottoms).toHaveLength(2);
    expect(new Set(bottoms.map((p) => p.lane)).size).toBe(2);
  });

  it('serbest kalan şeritler yeniden kullanılır', () => {
    // 10 ardışık kısa ömürlü branch, her biri merge ile kapanır. En yeniden en eskiye: m9, f9, m8, f8, ...
    const commits: CommitSummary[] = [];
    for (let i = 9; i >= 0; i--) {
      const prev = i === 0 ? 'root' : `m${i - 1}`;
      commits.push(c(`m${i}`, prev, `f${i}`), c(`f${i}`, prev));
    }
    commits.push(c('root'));
    const l = run(commits);
    expect(l.laneCount).toBe(2);
  });

  it('rastgele DAG\'larda sözleşme korunur', () => {
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 40; t++) {
      // Eskiden yeniye üret, sonra ters çevir (topolojik: çocuk parent'tan önce).
      const n = 30 + Math.floor(rand() * 50);
      const old: CommitSummary[] = [];
      for (let i = 0; i < n; i++) {
        const parents: string[] = [];
        if (i > 0) {
          const k = rand() < 0.15 ? (rand() < 0.2 ? 3 : 2) : rand() < 0.05 ? 0 : 1;
          for (let j = 0; j < k; j++) {
            const p = `h${Math.max(0, i - 1 - Math.floor(rand() * Math.min(i, 8)))}`;
            if (!parents.includes(p)) parents.push(p);
          }
        }
        old.push(c(`h${i}`, ...parents));
      }
      const commits = old.reverse();
      // Bazılarında alttan kes (limit dışı parent'lar)
      run(t % 3 === 0 ? commits.slice(0, Math.floor(n * 0.6)) : commits);
    }
  });

  it('doğrulayıcının kendisi bozuk yerleşimleri yakalar', () => {
    const commits = [c('M', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')];
    const good = layoutGraph(commits);
    const clone = (): GraphLayout => JSON.parse(JSON.stringify(good)) as GraphLayout;

    // İki satıra yayılan şerit değişimi.
    const multiRow = clone();
    const fEdge = multiRow.edges.find((e) => e.points[0]!.row === 1)!;
    fEdge.points = [fEdge.points[0]!, { row: 3, lane: 0 }];
    expect(() => validate(commits, multiRow)).toThrow();

    // Commit düğümünün üstünden geçen düz kenar.
    const throughNode = clone();
    throughNode.rows[1]!.lane = 0;
    expect(() => validate(commits, throughNode)).toThrow();

    // Eksik kenar.
    const missing = clone();
    missing.edges.pop();
    expect(() => validate(commits, missing)).toThrow();

    // Farklı parent'lara giden iki kenarın aynı şeridi paylaşması.
    const overlap = [c('x', 'p'), c('y', 'q'), c('p'), c('q')];
    const bad: GraphLayout = {
      laneCount: 2,
      rows: [
        { hash: 'x', lane: 0, color: 0, isMerge: false },
        { hash: 'y', lane: 1, color: 1, isMerge: false },
        { hash: 'p', lane: 1, color: 0, isMerge: false },
        { hash: 'q', lane: 0, color: 1, isMerge: false },
      ],
      edges: [
        { color: 0, points: [{ row: 0, lane: 0 }, { row: 1, lane: 0 }, { row: 2, lane: 1 }] },
        { color: 1, points: [{ row: 1, lane: 1 }, { row: 2, lane: 0 }, { row: 3, lane: 0 }] },
      ],
    };
    expect(() => validate(overlap, bad)).not.toThrow(); // yalnızca kesişme, çakışma yok
    bad.edges[1] = { color: 1, points: [{ row: 1, lane: 1 }, { row: 2, lane: 1 }, { row: 3, lane: 0 }] };
    expect(() => validate(overlap, bad)).toThrow(); // p düğümünden geçer
    bad.rows[2]!.lane = 2;
    bad.laneCount = 3;
    bad.edges[0] = { color: 0, points: [{ row: 0, lane: 0 }, { row: 1, lane: 1 }, { row: 2, lane: 2 }] };
    expect(() => validate(overlap, bad)).toThrow(); // iki kenar (1,1)'de buluşup farklı yerlere gider
  });

  it('2000 commit < 50 ms', () => {
    const commits: CommitSummary[] = [];
    // Çok sayıda branch ve merge içeren uzun geçmiş
    for (let i = 1999; i >= 0; i--) {
      const parents: string[] = [];
      if (i > 0) parents.push(`h${i - 1}`);
      if (i > 5 && i % 7 === 0) parents.push(`h${i - 5}`);
      commits.push(c(`h${i}`, ...parents));
    }
    layoutGraph(commits); // ısınma
    const t0 = performance.now();
    const l = layoutGraph(commits);
    const ms = performance.now() - t0;
    expect(l.rows).toHaveLength(2000);
    expect(ms).toBeLessThan(50);
    validate(commits, l);
  });
});
