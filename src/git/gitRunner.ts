import { execFile } from 'node:child_process';

export type GitErrorCode = 'notFound' | 'notRepo' | 'failed';

export type GitErrorKind = 'auth' | 'nonFastForward' | 'conflict' | 'noUpstream' | 'dirtyTree' | 'network';

export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly stderr: string;
  readonly stdout: string;
  /** Yalnızca 'failed' hatalarda: stderr + stdout'tan çıkarılan sınıf (merge çakışması stdout'a yazılır). */
  readonly kind?: GitErrorKind;

  constructor(code: GitErrorCode, message: string, stderr = '', stdout = '') {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
    if (code === 'failed') {
      const kind = classifyGitError(`${stderr}\n${stdout}`);
      if (kind) this.kind = kind;
    }
  }
}

const KIND_PATTERNS: [GitErrorKind, RegExp][] = [
  [
    'auth',
    /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Invalid username or password|Permission denied \(publickey|returned error: 40[13]|Support for password authentication was removed/i,
  ],
  [
    'dirtyTree',
    /Your local changes to the following files would be overwritten|untracked working tree files would be (overwritten|removed)|Please commit your changes or stash them|You have unstaged changes|Your index contains uncommitted changes/i,
  ],
  ['conflict', /CONFLICT \(|Automatic merge failed|could not apply|Resolve all conflicts|resolve your current index first|needs merge|unmerged files|fix conflicts/i],
  ['noUpstream', /has no upstream branch|no tracking information for the current branch|no upstream configured/i],
  [
    'nonFastForward',
    /non-fast-forward|\(fetch first\)|Updates were rejected|Not possible to fast-forward|stale info|divergent branches|tip of your current branch is behind/i,
  ],
  [
    'network',
    /Could not resolve host|unable to access|Connection (timed out|refused|reset)|Could not read from remote repository|early EOF|remote end hung up|Operation timed out|Failed to connect|Network is unreachable/i,
  ],
];

/** İngilizce git hata mesajını sınıflandırır (LC_ALL=C ile çalıştırıldığı için). */
export function classifyGitError(stderr: string): GitErrorKind | undefined {
  for (const [kind, re] of KIND_PATTERNS) if (re.test(stderr)) return kind;
  return undefined;
}

export interface RunGitOptions {
  /** Ek ortam değişkenleri (varsayılanları ezer). */
  env?: Record<string, string>;
  /** Dolarsa süreç öldürülür ve GitError('failed') fırlar. */
  timeoutMs?: number;
  /** stdin'e yazılacak metin. */
  input?: string;
}

let gitPath = 'git';

/** rewiewrev.git.path; boş/undefined → PATH'teki 'git'. */
export function setGitPath(path: string | undefined): void {
  gitPath = path?.trim() || 'git';
}

/** `git` komutunu shell olmadan çalıştırır, stdout'u döner. */
export function runGit(args: string[], cwd: string, opts: RunGitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      gitPath,
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 1024,
        windowsHide: true,
        ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
        env: {
          ...process.env,
          // Hata mesajları İngilizce gelsin ki tanınsın.
          LC_ALL: 'C',
          LANGUAGE: 'C',
          // Git asla terminalden şifre sormasın, editör açmasın.
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          GIT_MERGE_AUTOEDIT: 'no',
          ...opts.env,
        },
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === 'ENOENT') {
          const message =
            gitPath === 'git'
              ? 'Git bulunamadı. Git kurulu ve PATH üzerinde olmalı.'
              : `Git bulunamadı: ${gitPath}. rewiewrev.git.path ayarını kontrol edin.`;
          reject(new GitError('notFound', message, stderr, stdout));
          return;
        }
        if (e.killed && opts.timeoutMs !== undefined) {
          const sec = Math.round(opts.timeoutMs / 1000);
          reject(new GitError('failed', `Git işlemi zaman aşımına uğradı (${sec} sn).`, stderr, stdout));
          return;
        }
        if (/not a git repository/i.test(stderr)) {
          reject(new GitError('notRepo', 'Bu klasör bir git reposu değil.', stderr, stdout));
          return;
        }
        const detail = stderr.trim() || err.message;
        reject(new GitError('failed', `Git komutu başarısız oldu (git ${args.join(' ')}): ${detail}`, stderr, stdout));
      },
    );
    // stdin hep kapatılır; git hiçbir şey beklemez.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts.input ?? '');
  });
}
