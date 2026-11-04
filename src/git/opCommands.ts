// SAF: node/vscode/DOM import yok; webview de "Çalışacak komut" önizlemesi için kullanır.
import type { GitOpRequest, WorkingTreeStatus } from '../types';
import { sideExists } from './conflictSides';

export interface OpContext {
  /** Lokal branch adları (checkout'ta remote → lokal eşleşmesi için). */
  localBranches?: string[];
  /** Remote adları; varsayılan ['origin']. */
  remotes?: string[];
}

/** İşlemin varsayılan yolunda çalışacak git argümanları ('git' hariç), sırayla. */
export function opCommands(op: GitOpRequest, status?: WorkingTreeStatus, ctx: OpContext = {}): string[][] {
  const hasHead = status === undefined || status.head !== undefined;
  switch (op.kind) {
    case 'stage':
    case 'markResolved':
      return op.paths.length ? [['add', '--', ...op.paths]] : [];
    case 'stageAll':
      return [['add', '-A']];
    case 'bisectStart':
      return [['bisect', 'start', op.bad, op.good]];
    case 'bisectMark':
      return [['bisect', op.mark, ...(op.rev ? [op.rev] : [])]];
    case 'bisectReset':
      return [['bisect', 'reset']];
    case 'resolveSide': {
      const kind = status?.files.find((f) => f.path === op.path)?.conflict;
      if (!sideExists(kind, op.side)) return [['rm', '--', op.path]];
      return [['checkout', `--${op.side}`, '--', op.path], ['add', '--', op.path]];
    }
    case 'unstage':
      if (!op.paths.length) return [];
      return [hasHead ? ['restore', '--staged', '--', ...op.paths] : ['rm', '--cached', '-r', '--', ...op.paths]];
    case 'unstageAll':
      return [hasHead ? ['restore', '--staged', '--', '.'] : ['rm', '--cached', '-r', '--', '.']];
    case 'discard': {
      const untracked = new Set(status?.files.filter((f) => f.unstaged === 'untracked').map((f) => f.path) ?? []);
      const tracked = op.paths.filter((p) => !untracked.has(p));
      const fresh = op.paths.filter((p) => untracked.has(p));
      const cmds: string[][] = [];
      if (tracked.length) cmds.push(['restore', '--worktree', '--', ...tracked]);
      if (fresh.length) cmds.push(['clean', '-f', '--', ...fresh]);
      return cmds;
    }
    case 'commit': {
      const { summary, body } = splitMessage(op.message);
      const cmd = ['commit'];
      if (summary === '' && op.amend) cmd.push('--no-edit');
      else {
        cmd.push('-m', summary);
        if (body !== '') cmd.push('-m', body);
      }
      if (op.amend) cmd.push('--amend');
      return op.push ? [cmd, pushCommand(false, status)] : [cmd];
    }
    case 'undoLastCommit':
      return [['reset', '--soft', 'HEAD~1']];
    case 'fetch':
      return [['fetch', '--prune']];
    case 'pull':
      if (op.strategy === 'merge') return [['pull', '--no-rebase']];
      if (op.strategy === 'rebase') return [['pull', '--rebase']];
      return [['pull', '--ff-only']];
    case 'push':
      return [pushCommand(op.force === true, status)];
    case 'checkout': {
      const locals = new Set(ctx.localBranches ?? []);
      if (locals.has(op.branch)) return [['switch', op.branch]];
      const remote = (ctx.remotes ?? ['origin']).find((r) => op.branch.startsWith(`${r}/`));
      if (!remote) return [['switch', op.branch]];
      const short = op.branch.slice(remote.length + 1);
      return locals.has(short) ? [['switch', short]] : [['switch', '--track', op.branch]];
    }
    case 'createBranch': {
      const from = op.from ? [op.from] : [];
      return [op.checkout ? ['switch', '-c', op.name, ...from] : ['branch', op.name, ...from]];
    }
    case 'mergeBranch':
      return [['merge', '--no-edit', op.branch]];
    case 'renameBranch':
      return [['branch', '-m', op.from, op.to]];
    case 'deleteBranch':
      return [['branch', '-d', op.name]];
    case 'stashSave': {
      const msg = op.message?.trim();
      return [['stash', 'push', ...(op.includeUntracked ? ['-u'] : []), ...(msg ? ['-m', msg] : [])]];
    }
    case 'stashApply':
      return [['stash', op.pop ? 'pop' : 'apply', `stash@{${op.index}}`]];
    case 'stashDrop':
      return [['stash', 'drop', `stash@{${op.index}}`]];
    case 'continueOperation':
      switch (status?.operation) {
        // merge --continue eski git'te yok ve editör ister; commit --no-edit aynı işi yapar.
        case 'merge':
          return [['commit', '--no-edit']];
        case 'rebase':
          return [['rebase', '--continue']];
        case 'cherryPick':
          return [['cherry-pick', '--continue']];
        case 'revert':
          return [['revert', '--continue']];
        default:
          return [];
      }
    case 'abortOperation':
      switch (status?.operation) {
        case 'merge':
          return [['merge', '--abort']];
        case 'rebase':
          return [['rebase', '--abort']];
        case 'cherryPick':
          return [['cherry-pick', '--abort']];
        case 'revert':
          return [['revert', '--abort']];
        default:
          return [];
      }
  }
}

function pushCommand(force: boolean, status?: WorkingTreeStatus): string[] {
  const forceArg = force ? ['--force-with-lease'] : [];
  if (status && status.upstream === undefined && status.branch !== undefined) {
    return ['push', '-u', ...forceArg, 'origin', status.branch];
  }
  return ['push', ...forceArg];
}

/** İlk satır özet; sonraki satırlar (baştaki boş satırlar atılarak) açıklama. */
export function splitMessage(message: string): { summary: string; body: string } {
  const lines = message.replace(/\r\n?/g, '\n').split('\n');
  const summary = (lines[0] ?? '').trim();
  const body = lines.slice(1).join('\n').replace(/^\s*\n/, '').trimEnd();
  return { summary, body: body.trim() === '' ? '' : body };
}

/** "git push -u origin feature/x"; boşluklu/özel karakterli argümanlar tırnaklanır. */
export function formatCommand(args: string[]): string {
  return ['git', ...args.map(quoteArg)].join(' ');
}

function quoteArg(a: string): string {
  if (a !== '' && !/[\s"'`$\\;&|<>()]/.test(a)) return a;
  return `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** `git check-ref-format --branch` kurallarının saf karşılığı (isSafeRefName ile uyumlu). */
export function isValidBranchName(name: string): boolean {
  if (name === '' || name.length > 255 || name === '@' || name === 'HEAD') return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false;
  if (/[\s\x00-\x1f\x7f~^:?*[\\]/.test(name)) return false;
  return name.split('/').every((seg) => !seg.startsWith('.') && !seg.endsWith('.lock'));
}
