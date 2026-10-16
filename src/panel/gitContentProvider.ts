import * as vscode from 'vscode';
import { GitError, runGit } from '../git/gitRunner';

export const GIT_SCHEME = 'rewiewrev-git';

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
    try {
      return await runGit(['show', `${q.ref}:${q.path}`], q.root);
    } catch (err) {
      // Dosya o ref'te yoksa (eklenmiş/silinmiş) boş içerik göster.
      if (err instanceof GitError && err.code === 'failed' && /does not exist|exists on disk, but not in/i.test(err.stderr)) {
        return '';
      }
      throw err;
    }
  }
}
