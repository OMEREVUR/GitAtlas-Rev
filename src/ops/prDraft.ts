// Commit'lerden PR taslağı (başlık + açıklama).
import { runGit } from '../git/gitRunner';
import { logArgs, parseNumstatLog } from '../git/logParser';
import { getStatus } from '../git/status';
import { text } from '../i18n/ops';
import type { CommitSummary, PrDraft } from '../types';

/** "feature/graph-kenarlari" → "Graph kenarlari". */
export function titleFromBranch(branch: string): string {
  const last = branch.slice(branch.lastIndexOf('/') + 1);
  const words = last.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (words === '') return branch;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * SAF. commits: base..head, en yeniden en eskiye (git log sırası).
 * Tek commit → başlık = commit mesajı; birden çok → başlık branch adından, açıklama commit listesi.
 */
export function buildPrDraft(commits: CommitSummary[], head: string, _base: string): { title: string; body: string } {
  const only = commits.length === 1 ? commits[0] : undefined;
  if (only) return { title: only.message, body: '' };
  if (commits.length === 0) return { title: titleFromBranch(head), body: '' };
  const items = [...commits].reverse().map((c) => `- ${c.message}`);
  return { title: titleFromBranch(head), body: [text().prDraftChangesHeading, '', ...items].join('\n') };
}

async function refExists(root: string, ref: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root);
    return true;
  } catch {
    return false;
  }
}

/** Mevcut branch için PR taslağı. base = verilen ?? varsayılan branch ?? 'main'. */
export async function computePrDraft(root: string, base: string | undefined, defaultBranch: string | undefined): Promise<PrDraft> {
  const status = await getStatus(root);
  const head = status.branch;
  if (!head) throw new Error(text().prNeedsBranch);
  const target = base ?? defaultBranch ?? 'main';

  let from: string;
  if (await refExists(root, `origin/${target}`)) from = `origin/${target}`;
  else if (await refExists(root, target)) from = target;
  else throw new Error(text().targetBranchNotFound(target));

  const commits = parseNumstatLog(await runGit(logArgs(`${from}..HEAD`), root));
  const { title, body } = buildPrDraft(commits, head, target);
  return {
    head,
    base: target,
    title,
    body,
    commits: commits.length,
    needsPush: status.upstream === undefined || status.ahead > 0,
  };
}
