import { GitError, runGit } from '../git/gitRunner';

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** github.com remote adresinden owner/repo; GitHub değilse (GitLab, Enterprise) undefined. */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | undefined {
  const trimmed = url.trim();
  let host: string;
  let pathPart: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return undefined;
    }
    host = parsed.hostname;
    pathPart = decodeURIComponent(parsed.pathname);
  } else {
    // scp biçimi: git@github.com:owner/repo.git
    const m = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
    if (!m) return undefined;
    host = m[1] ?? '';
    pathPart = m[2] ?? '';
  }
  if (!GITHUB_HOSTS.has(host.toLowerCase())) return undefined;
  const segments = pathPart
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/');
  if (segments.length !== 2) return undefined;
  const [owner = '', repo = ''] = segments;
  if (owner === '' || repo === '') return undefined;
  return { owner, repo };
}

/** Adresteki kullanıcı adı/token kısmını atar (durum mesajında göstermek için). */
export function redactRemoteUrl(url: string): string {
  return url.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}

/** `origin` remote adresi; remote yoksa undefined. */
export async function getOriginUrl(root: string): Promise<string | undefined> {
  try {
    const out = (await runGit(['remote', 'get-url', 'origin'], root)).trim();
    return out === '' ? undefined : out;
  } catch (err) {
    if (err instanceof GitError && err.code === 'failed') return undefined;
    throw err;
  }
}
