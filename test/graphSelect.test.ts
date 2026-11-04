import { describe, expect, it } from 'vitest';
import { applyRowClick, branchCommits, filterGraphCommits, graphAuthors, pickOrder, reachable } from '../src/model/graphSelect';
import type { CommitFileChange, CommitSummary, GitRef } from '../src/types';

function c(
  hash: string,
  parents: string[],
  opts: { author?: string; date?: number; message?: string; files?: CommitFileChange[] } = {},
): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    author: opts.author ?? 'Ayse',
    email: 'x@example.com',
    date: opts.date ?? 0,
    message: opts.message ?? hash,
    files: opts.files ?? [],
  };
}

function ref(name: string, hash: string, extra: Partial<GitRef> = {}): GitRef {
  return {
    name,
    fullName: `refs/heads/${name}`,
    kind: 'local',
    hash,
    isHead: false,
    date: 0,
    subject: '',
    author: '',
    ...extra,
  };
}

// main: m3 → m2 → m1 → m0 ; feature: f2 → f1 → m1 ; origin/main = m1
const commits: CommitSummary[] = [
  c('m3', ['m2']),
  c('f2', ['f1']),
  c('m2', ['m1']),
  c('f1', ['m1']),
  c('m1', ['m0']),
  c('m0', []),
];
const main = ref('main', 'm3', { isHead: true, upstream: 'origin/main' });
const feature = ref('feature', 'f2');
const originMain = ref('origin/main', 'm1', { kind: 'remote', fullName: 'refs/remotes/origin/main' });
const refs = [main, feature, originMain];

describe('reachable', () => {
  it('parent\'lar üzerinden, yalnızca yüklü commit\'ler', () => {
    expect(reachable('f2', commits)).toEqual(new Set(['f2', 'f1', 'm1', 'm0']));
    expect(reachable('m1', commits.slice(0, 5))).toEqual(new Set(['m1']));
    expect(reachable('yok', commits).size).toBe(0);
  });
});

describe('branchCommits', () => {
  const hashes = (list: CommitSummary[]): string[] => list.map((x) => x.hash);

  it('HEAD dışı branch: HEAD\'den ulaşılamayan commit\'leri, commits sırasıyla', () => {
    expect(hashes(branchCommits(feature, refs, commits, 'm3'))).toEqual(['f2', 'f1']);
  });

  it('HEAD branch\'i: upstream\'e göre (push edilmemiş commit\'ler)', () => {
    expect(hashes(branchCommits(main, refs, commits, 'm3'))).toEqual(['m3', 'm2']);
  });

  it('base yoksa yalnızca uç commit', () => {
    expect(hashes(branchCommits(feature, refs, commits))).toEqual(['f2']);
    const noUpstream = ref('main', 'm3', { isHead: true });
    expect(hashes(branchCommits(noUpstream, refs, commits, 'm3'))).toEqual(['m3']);
  });

  it('sonuç boşsa yalnızca uç commit; uç yüklü değilse boş', () => {
    const behind = ref('old', 'm1');
    expect(hashes(branchCommits(behind, refs, commits, 'm3'))).toEqual(['m1']);
    const unloaded = ref('far', 'zzz');
    expect(branchCommits(unloaded, refs, commits, 'm3')).toEqual([]);
  });
});

describe('filterGraphCommits', () => {
  const list: CommitSummary[] = [
    c('abc123', [], { author: 'Ayse', date: 300, message: 'feat: Treemap zoom', files: [{ path: 'src/webview/treemap.ts', added: 1, deleted: 0 }] }),
    c('def456', [], { author: 'Mehmet', date: 200, message: 'fix: parser', files: [{ path: 'src/git/new.ts', oldPath: 'src/git/OldParser.ts', added: 0, deleted: 0 }] }),
    c('abd789', [], { author: 'Ayse', date: 100, message: 'docs', files: [] }),
  ];
  const ids = (s: Set<string>): string[] => [...s].sort();

  it('boş filtre hepsini döner', () => {
    expect(ids(filterGraphCommits(list, {}))).toEqual(['abc123', 'abd789', 'def456']);
    expect(ids(filterGraphCommits(list, { query: '  ', author: '' }))).toEqual(['abc123', 'abd789', 'def456']);
  });

  it('yazar', () => {
    expect(ids(filterGraphCommits(list, { author: 'Ayse' }))).toEqual(['abc123', 'abd789']);
  });

  it('since (ms, dahil)', () => {
    expect(ids(filterGraphCommits(list, { since: 200 }))).toEqual(['abc123', 'def456']);
  });

  it('query: mesaj (büyük/küçük harf duyarsız), hash öneki, path ve oldPath', () => {
    expect(ids(filterGraphCommits(list, { query: 'TREEMAP' }))).toEqual(['abc123']);
    expect(ids(filterGraphCommits(list, { query: 'AB' }))).toEqual(['abc123', 'abd789']);
    expect(ids(filterGraphCommits(list, { query: '456' }))).toEqual([]);
    expect(ids(filterGraphCommits(list, { query: 'oldparser' }))).toEqual(['def456']);
    expect(ids(filterGraphCommits(list, { query: 'src/git' }))).toEqual(['def456']);
  });

  it('filtreler birlikte (VE)', () => {
    expect(ids(filterGraphCommits(list, { author: 'Ayse', since: 200, query: 'feat' }))).toEqual(['abc123']);
    expect(ids(filterGraphCommits(list, { author: 'Mehmet', query: 'treemap' }))).toEqual([]);
  });
});

describe('graphAuthors', () => {
  it('commit sayısına göre çoktan aza, eşitlikte ada göre', () => {
    const list = [
      c('1', [], { author: 'Zeynep' }),
      c('2', [], { author: 'Mehmet' }),
      c('3', [], { author: 'Zeynep' }),
      c('4', [], { author: 'Ayse' }),
      c('5', [], { author: 'Mehmet' }),
      c('6', [], { author: 'Zeynep' }),
    ];
    expect(graphAuthors(list)).toEqual(['Zeynep', 'Mehmet', 'Ayse']);
    expect(graphAuthors([])).toEqual([]);
  });
});

describe('çoklu seçim (0.4.0)', () => {
  const V = ['c5', 'c4', 'c3', 'c2', 'c1']; // graph sırası: yeniden eskiye
  const plain = { toggle: false, range: false };
  const toggle = { toggle: true, range: false };
  const range = { toggle: false, range: true };

  it('pickOrder graph sırasını tersine çevirir', () => {
    expect(pickOrder(['yeni', 'orta', 'eski'])).toEqual(['eski', 'orta', 'yeni']);
    expect(pickOrder([])).toEqual([]);
  });

  it('düz tıklama tek seçim; ikinci tıklama kaldırır; çokluyu sıfırlar', () => {
    expect(applyRowClick(V, { picked: [] }, 'c3', plain)).toEqual({ anchor: 'c3', picked: [] });
    expect(applyRowClick(V, { anchor: 'c3', picked: [] }, 'c3', plain)).toEqual({ anchor: undefined, picked: [] });
    expect(applyRowClick(V, { anchor: 'c3', picked: ['c3', 'c2'] }, 'c1', plain)).toEqual({ anchor: 'c1', picked: [] });
    // çoklu seçimdeyken aynı satıra düz tıklama: tek seçime iner, kaldırmaz
    expect(applyRowClick(V, { anchor: 'c3', picked: ['c3', 'c2'] }, 'c3', plain)).toEqual({ anchor: 'c3', picked: [] });
  });

  it('Ctrl/Cmd: anchor ile tohumlar, ekler, çıkarır, boşalınca tek seçime döner', () => {
    const a = applyRowClick(V, { anchor: 'c4', picked: [] }, 'c2', toggle);
    expect(a).toEqual({ anchor: 'c2', picked: ['c4', 'c2'] });
    const b = applyRowClick(V, a, 'c5', toggle);
    expect(b.picked).toEqual(['c5', 'c4', 'c2']); // görünür sıraya dizilir
    const c = applyRowClick(V, b, 'c4', toggle);
    expect(c.picked).toEqual(['c5', 'c2']);
    const d = applyRowClick(V, c, 'c2', toggle);
    expect(d).toEqual({ anchor: 'c5', picked: [] }); // tek kaldı → tek seçim
    expect(applyRowClick(V, { anchor: 'c5', picked: [] }, 'c5', toggle)).toEqual({ anchor: undefined, picked: [] });
  });

  it('Shift: anchor ile arası, iki yönde; anchor sabit kalır', () => {
    const down = applyRowClick(V, { anchor: 'c4', picked: [] }, 'c2', range);
    expect(down).toEqual({ anchor: 'c4', picked: ['c4', 'c3', 'c2'] });
    const up = applyRowClick(V, down, 'c5', range);
    expect(up).toEqual({ anchor: 'c4', picked: ['c5', 'c4'] }); // aynı anchor'dan yeniden süpürür
    // anchor yoksa düz tıklama gibi davranır
    expect(applyRowClick(V, { picked: [] }, 'c3', range)).toEqual({ anchor: 'c3', picked: [] });
  });

  it('süzülmüş listede aralık görünür sıraya göre hesaplanır', () => {
    const filtered = ['c5', 'c3', 'c1'];
    expect(applyRowClick(filtered, { anchor: 'c5', picked: [] }, 'c1', range)).toEqual({
      anchor: 'c5',
      picked: ['c5', 'c3', 'c1'],
    });
    // listede olmayan anchor: aralık kurulamaz, düz tıklama gibi
    expect(applyRowClick(filtered, { anchor: 'c4', picked: [] }, 'c1', range)).toEqual({ anchor: 'c1', picked: [] });
  });
});
