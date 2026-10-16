import { graphLogArgs } from '../git/graphLog';
import { GitError, runGit } from '../git/gitRunner';
import { parseNumstatLog } from '../git/logParser';
import { listRefs } from '../git/refs';
import type { CommitSummary, GraphData } from '../types';
import { layoutGraph } from './graphLayout';

/** HEAD'in hash'i; commit'siz repoda undefined. Repo değilse/git yoksa GitError fırlar. */
async function resolveHead(root: string): Promise<string | undefined> {
  try {
    return (await runGit(['rev-parse', '--verify', 'HEAD'], root)).trim();
  } catch (err) {
    if (err instanceof GitError && err.code === 'failed') return undefined;
    throw err;
  }
}

export async function loadGraph(root: string, opts: { limit: number; branch?: string }): Promise<GraphData> {
  const { limit, branch } = opts;
  const logPromise = runGit(graphLogArgs({ limit: limit + 1, branch }), root);
  // Boş repoda git log hata verir; HEAD sonucuna göre karar verilene kadar yakalanmamış reddi önle.
  logPromise.catch(() => undefined);

  const [head, refs] = await Promise.all([resolveHead(root), listRefs(root)]);

  let commits: CommitSummary[];
  try {
    commits = parseNumstatLog(await logPromise);
  } catch (err) {
    if (head === undefined && refs.length === 0 && err instanceof GitError && err.code === 'failed') commits = [];
    else throw err;
  }

  const hasMore = commits.length > limit;
  if (hasMore) commits = commits.slice(0, limit);

  const data: GraphData = {
    commits,
    layout: layoutGraph(commits),
    refs,
    limit,
    hasMore,
  };
  if (branch !== undefined) data.branch = branch;
  if (head !== undefined) data.head = head;
  const current = refs.find((r) => r.isHead)?.name;
  if (current !== undefined) data.currentBranch = current;
  return data;
}
