import { GitError, runGit } from '../git/gitRunner';
import { countLines, listTrackedFiles } from '../git/lineCounter';
import { logArgs, parseNumstatLog } from '../git/logParser';
import type { CommitSummary, RepoSnapshot } from '../types';
import { readSnapshot, writeSnapshot } from './cache';
import { text } from '../i18n/map';

/** Repo var ama henüz hiç commit yok (HEAD çözülemiyor). */
export class NoCommitsError extends Error {
  constructor() {
    super(text().noCommitsError);
    this.name = 'NoCommitsError';
  }
}

const COUNT_BATCH = 500;

async function resolveHead(root: string): Promise<string> {
  try {
    return (await runGit(['rev-parse', '--verify', 'HEAD'], root)).trim();
  } catch (err) {
    if (!(err instanceof GitError) || err.code !== 'failed') throw err;
    // HEAD yok: repo geçerliyse boş repodur; değilse git'in hatası yukarı çıkar.
    await runGit(['rev-parse', '--git-dir'], root);
    throw new NoCommitsError();
  }
}

async function isAncestor(root: string, oldHash: string, head: string): Promise<boolean> {
  try {
    await runGit(['merge-base', '--is-ancestor', oldHash, head], root);
    return true;
  } catch (err) {
    // Çıkış kodu 1 (ata değil) ya da 128 (hash artık yok) → tam tarama.
    if (err instanceof GitError && err.code === 'failed') return false;
    throw err;
  }
}

/** Satırları parça parça sayar; ilerlemeyi [from, to] aralığında bildirir. */
async function countInBatches(
  root: string,
  paths: string[],
  onProgress: (p: number) => void,
  from: number,
  to: number,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (let i = 0; i < paths.length; i += COUNT_BATCH) {
    Object.assign(result, await countLines(root, paths.slice(i, i + COUNT_BATCH)));
    const done = Math.min(i + COUNT_BATCH, paths.length);
    onProgress(from + ((to - from) * done) / paths.length);
  }
  return result;
}

async function fullScan(root: string, head: string, onProgress: (p: number) => void): Promise<RepoSnapshot> {
  const commits = parseNumstatLog(await runGit(logArgs(), root));
  onProgress(0.4);
  const tracked = await listTrackedFiles(root);
  onProgress(0.45);
  const lineCounts = await countInBatches(root, tracked, onProgress, 0.45, 0.95);
  return { root, headHash: head, generatedAt: Date.now(), commits, lineCounts };
}

async function incrementalScan(
  root: string,
  head: string,
  cached: RepoSnapshot,
  onProgress: (p: number) => void,
): Promise<RepoSnapshot> {
  const newCommits: CommitSummary[] = parseNumstatLog(await runGit(logArgs(`${cached.headHash}..HEAD`), root));
  onProgress(0.4);
  const tracked = await listTrackedFiles(root);
  onProgress(0.45);

  const touched = new Set<string>();
  for (const c of newCommits) for (const f of c.files) touched.add(f.path);

  const lineCounts: Record<string, number> = {};
  const toCount: string[] = [];
  for (const path of tracked) {
    const old = cached.lineCounts[path];
    // Binary dosyalar haritada olmadığı için burada yeniden denenir; countLines onları yine eler.
    if (old === undefined || touched.has(path)) toCount.push(path);
    else lineCounts[path] = old;
  }
  Object.assign(lineCounts, await countInBatches(root, toCount, onProgress, 0.45, 0.95));

  return {
    root,
    headHash: head,
    generatedAt: Date.now(),
    commits: [...newCommits, ...cached.commits],
    lineCounts,
  };
}

export async function loadSnapshot(
  root: string,
  storageDir: string,
  onProgress: (p: number) => void,
): Promise<RepoSnapshot> {
  onProgress(0);
  const head = await resolveHead(root);
  const cached = await readSnapshot(storageDir, root);
  onProgress(0.05);

  if (cached && cached.headHash === head) {
    onProgress(1);
    return cached;
  }

  const snapshot =
    cached && (await isAncestor(root, cached.headHash, head))
      ? await incrementalScan(root, head, cached, onProgress)
      : await fullScan(root, head, onProgress);

  await writeSnapshot(storageDir, snapshot);
  onProgress(1);
  return snapshot;
}
