// Graph seçim ve filtre yardımcıları. SAF: node/DOM import'u yok.
import type { CommitSummary, GitRef } from '../types';

/** fromHash'ten parent'lar üzerinden ulaşılan commit'ler (yalnızca yüklü olanlar, fromHash dahil). */
export function reachable(fromHash: string, commits: CommitSummary[]): Set<string> {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const seen = new Set<string>();
  const stack = [fromHash];
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (seen.has(hash)) continue;
    const commit = byHash.get(hash);
    if (!commit) continue;
    seen.add(hash);
    for (const p of commit.parents) if (!seen.has(p)) stack.push(p);
  }
  return seen;
}

/**
 * Branch'in "kendi" commit'leri: reachable(ref) − reachable(base).
 * base: HEAD branch'i için upstream'i, diğerleri için HEAD. Sonuç boşsa yalnızca uç commit.
 */
export function branchCommits(
  ref: GitRef,
  refs: GitRef[],
  commits: CommitSummary[],
  headHash?: string,
): CommitSummary[] {
  const tipOnly = commits.filter((c) => c.hash === ref.hash);
  const base = ref.isHead
    ? refs.find((r) => r.name === ref.upstream && r.kind !== 'tag' && r !== ref)?.hash
    : headHash;
  if (base === undefined) return tipOnly;

  const own = reachable(ref.hash, commits);
  for (const h of reachable(base, commits)) own.delete(h);
  if (own.size === 0) return tipOnly;
  return commits.filter((c) => own.has(c.hash));
}

export interface GraphFilter {
  author?: string;
  query?: string;
  /** Bu tarihten (ms) sonra ya da tam o anda yazılmış commit'ler. */
  since?: number;
}

/** Filtreye uyan commit'lerin hash'leri. Boş filtre hepsini döner. */
export function filterGraphCommits(commits: CommitSummary[], f: GraphFilter): Set<string> {
  const query = f.query?.trim().toLowerCase() ?? '';
  const result = new Set<string>();
  for (const c of commits) {
    if (f.author !== undefined && f.author !== '' && c.author !== f.author) continue;
    if (f.since !== undefined && c.date < f.since) continue;
    if (
      query !== '' &&
      !c.message.toLowerCase().includes(query) &&
      !c.hash.toLowerCase().startsWith(query) &&
      !c.files.some(
        (file) =>
          file.path.toLowerCase().includes(query) ||
          (file.oldPath !== undefined && file.oldPath.toLowerCase().includes(query)),
      )
    ) {
      continue;
    }
    result.add(c.hash);
  }
  return result;
}

/** Yazar adları, commit sayısına göre çoktan aza (eşitlikte ada göre). */
export function graphAuthors(commits: CommitSummary[]): string[] {
  const counts = new Map<string, number>();
  for (const c of commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

// ---- 0.4.0: cherry-pick için çoklu seçim (saf) ----

/** Graph sırası (yeniden eskiye) → cherry-pick uygulama sırası (eskiden yeniye). */
export function pickOrder(graphOrder: readonly string[]): string[] {
  return [...graphOrder].reverse();
}

/** Çoklu seçim durumu: anchor hem detay panelini sürer hem Shift aralığının başlangıcıdır. */
export interface PickState {
  anchor?: string;
  /** Graph sırasında, seçili commit'ler. Tek seçimde boş kalır. */
  picked: string[];
}

/**
 * Bir satıra tıklamanın çoklu seçime etkisi.
 * - düz tıklama: tek seçime döner (aynı satıra ikinci tıklama seçimi kaldırır)
 * - toggle (Ctrl/Cmd): kümeye ekler/çıkarır; küme boşsa önce anchor'la tohumlanır
 * - range (Shift): anchor ile tıklanan satır arasını (görünür sırada) seçer, anchor değişmez
 */
export function applyRowClick(
  visible: readonly string[],
  cur: PickState,
  hash: string,
  mods: { toggle: boolean; range: boolean },
): PickState {
  if (mods.range && cur.anchor !== undefined) {
    const a = visible.indexOf(cur.anchor);
    const b = visible.indexOf(hash);
    if (a >= 0 && b >= 0) {
      const [from, to] = a <= b ? [a, b] : [b, a];
      return { anchor: cur.anchor, picked: visible.slice(from, to + 1) };
    }
  }
  if (mods.toggle) {
    const seed = cur.picked.length > 0 ? cur.picked : cur.anchor !== undefined ? [cur.anchor] : [];
    const next = seed.includes(hash) ? seed.filter((h) => h !== hash) : [...seed, hash];
    // Görünür sıraya göre diz, böylece pickOrder tek başına yeterli olur.
    const ordered = visible.filter((h) => next.includes(h));
    for (const h of next) if (!ordered.includes(h)) ordered.push(h);
    if (ordered.length === 0) return { anchor: undefined, picked: [] };
    if (ordered.length === 1) return { anchor: ordered[0], picked: [] };
    return { anchor: ordered.includes(hash) ? hash : ordered[0], picked: ordered };
  }
  // Düz tıklama: bugünkü davranış (ikinci tıklama seçimi kaldırır).
  if (cur.picked.length === 0 && cur.anchor === hash) return { anchor: undefined, picked: [] };
  return { anchor: hash, picked: [] };
}
