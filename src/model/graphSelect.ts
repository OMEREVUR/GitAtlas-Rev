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
