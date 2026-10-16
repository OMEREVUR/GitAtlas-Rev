import type { FileStat, RepoSnapshot, TimeRange } from '../types';
import { compileGlobs } from './glob';

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeStart(range: TimeRange, now: number): number {
  switch (range) {
    case '7d':
      return now - 7 * DAY_MS;
    case '30d':
      return now - 30 * DAY_MS;
    case 'all':
      return Number.NEGATIVE_INFINITY;
  }
}

interface Acc {
  changes: number;
  added: number;
  deleted: number;
  lastModified: number;
  authors: Map<string, number>;
}

export function computeFileStats(
  snapshot: RepoSnapshot,
  range: TimeRange,
  ignore: string[],
  now: number,
): FileStat[] {
  const isIgnored = compileGlobs(ignore);
  const start = rangeStart(range, now);

  const accs = new Map<string, Acc>();
  for (const path of Object.keys(snapshot.lineCounts)) {
    if (isIgnored(path)) continue;
    accs.set(path, { changes: 0, added: 0, deleted: 0, lastModified: 0, authors: new Map() });
  }

  // Eski ad → bugünkü ad. Commit'ler yeniden eskiye gezildiği için zincir doğru çözülür.
  const alias = new Map<string, string>();

  for (const commit of snapshot.commits) {
    const inRange = commit.date >= start;
    const touched = new Set<string>();
    for (const change of commit.files) {
      const target = alias.get(change.path) ?? change.path;
      if (change.oldPath !== undefined && change.oldPath !== change.path) {
        alias.set(change.oldPath, target);
      }
      const acc = accs.get(target);
      if (!acc) continue;
      if (commit.date > acc.lastModified) acc.lastModified = commit.date;
      if (!inRange) continue;
      acc.added += change.added;
      acc.deleted += change.deleted;
      if (!touched.has(target)) {
        touched.add(target);
        acc.changes++;
        acc.authors.set(commit.author, (acc.authors.get(commit.author) ?? 0) + 1);
      }
    }
  }

  const result: FileStat[] = [];
  for (const [path, acc] of accs) {
    const authors = [...acc.authors.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
    result.push({
      path,
      lines: snapshot.lineCounts[path] ?? 0,
      changes: acc.changes,
      added: acc.added,
      deleted: acc.deleted,
      lastModified: acc.lastModified,
      authors,
    });
  }
  return result;
}
