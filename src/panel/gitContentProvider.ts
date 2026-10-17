import * as vscode from 'vscode';
import { GitError, runGit } from '../git/gitRunner';

export const GIT_SCHEME = 'gitatlas-revrev-git';
/** makeGitUri'de index'teki içerik için özel ref. */
export const INDEX_REF = ':index';

const MISSING_RE =
  /does not exist|exists on disk, but not in|not in the index|is in the index, but not at stage 0|invalid object name|bad revision|unknown revision/i;

interface GitUriQuery {
  root: string;
  ref: string;
  path: string;
}

/**
 * Bir dosyanın belirli bir ref'teki içeriği için URI.
 * ref '' = boş içerik (kök commit'in "öncesi"). URI yolu dosya yolu olur ki
 * editör sekme adı ve dil tanıma doğru çalışsın.
 */
export function makeGitUri(root: string, ref: string, path: string): vscode.Uri {
  const query: GitUriQuery = { root, ref, path };
  return vscode.Uri.from({ scheme: GIT_SCHEME, path: '/' + path, query: JSON.stringify(query) });
}

export function parseGitUriQuery(query: string): GitUriQuery | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(query);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { root, ref, path } = raw as Record<string, unknown>;
  if (typeof root !== 'string' || typeof ref !== 'string' || typeof path !== 'string') return undefined;
  return { root, ref, path };
}

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const q = parseGitUriQuery(uri.query);
    if (!q || q.ref === '') return '';
    // INDEX_REF → `git show :<path>` (index'teki hâl).
    const spec = q.ref === INDEX_REF ? `:${q.path}` : `${q.ref}:${q.path}`;
    try {
      return await runGit(['show', spec], q.root);
    } catch (err) {
      // Dosya o ref'te/index'te yoksa (eklenmiş/silinmiş/untracked), HEAD yoksa (boş repo)
      // ya da çakışmalı dosya index'te stage 0'da değilse boş içerik göster.
      if (err instanceof GitError && err.code === 'failed' && MISSING_RE.test(err.stderr)) return '';
      throw err;
    }
  }
}
