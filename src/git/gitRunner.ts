import { execFile } from 'node:child_process';

export type GitErrorCode = 'notFound' | 'notRepo' | 'failed';

export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly stderr: string;

  constructor(code: GitErrorCode, message: string, stderr = '') {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
  }
}

/** `git` komutunu shell olmadan çalıştırır, stdout'u döner. */
export function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 1024,
        windowsHide: true,
        // Hata mesajları İngilizce gelsin ki "not a git repository" tanınsın.
        env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' },
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }
        const errCode: unknown = (err as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          reject(new GitError('notFound', 'Git bulunamadı. Git kurulu ve PATH üzerinde olmalı.', stderr));
          return;
        }
        if (/not a git repository/i.test(stderr)) {
          reject(new GitError('notRepo', 'Bu klasör bir git reposu değil.', stderr));
          return;
        }
        const detail = stderr.trim() || err.message;
        reject(new GitError('failed', `Git komutu başarısız oldu (git ${args.join(' ')}): ${detail}`, stderr));
      },
    );
  });
}
