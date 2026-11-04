// Webview'dan gelen git işlemlerini sırayla, onaylarıyla ve etkin dilde (tr/en) sonuç mesajlarıyla yürütür.
// VS Code'dan bağımsızdır: diyaloglar OpsUi, kimlik GetToken üzerinden gelir.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createAskpassEnv } from '../git/askpass';
import { sideExists, sideRole, type ConflictSide } from '../git/conflictSides';
import { GitError, runGit } from '../git/gitRunner';
import { formatCommand, isValidBranchName, opCommands } from '../git/opCommands';
import { getStatus, listStashes } from '../git/status';
import { getBisectState } from '../git/bisect';
import { text } from '../i18n/ops';
import type { GitOpRequest, OpResult, RepoOperation, WorkingTreeStatus } from '../types';
import { OpQueue } from './opQueue';

export interface OpsUi {
  /** Modal "Evet/İptal"; action = onay butonunun metni (ör. "Geri al"). */
  confirm(message: string, detail: string, action: string): Promise<boolean>;
  pick<T extends string>(title: string, items: { id: T; label: string; detail?: string }[]): Promise<T | undefined>;
}

export interface OpsDeps {
  root: string;
  ui: OpsUi;
  /** GitHub oturumu varsa token; kimlik hatasında bir kez yedek olarak kullanılır. */
  getToken?: () => Promise<string | undefined>;
  pullStrategy: () => 'ask' | 'merge' | 'rebase';
  /** Çıktı kanalı satırı. Token asla yazılmaz. */
  log: (line: string) => void;
}

const NETWORK_TIMEOUT_MS = 120_000;
const NETWORK_OPS = new Set(['fetch', 'pull', 'push']);

const OPERATION_LABEL: Record<RepoOperation, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  cherryPick: 'Cherry-pick',
  revert: 'Revert',
};

// Mesajlarda ref adlarına Türkçe ek getirilmez ("master'e" gibi yanlış ekler çıkar); ad ayrı yazılır.
// Kullanıcıya görünen tüm metinler src/i18n/ops.ts sözlüğünden gelir; text() her çağrıda etkin dili okur.

/** Bir işlem boyunca kullanılan çalıştırma bağlamı (komut kaydı, log, askpass yedeği). GitHubOpsService de kullanır. */
export type OpRunDeps = Pick<OpsDeps, 'root' | 'getToken' | 'log'>;

export class OpRun {
  readonly commands: string[] = [];
  readonly outputs: string[] = [];
  private authEnv?: { env: Record<string, string>; dispose: () => Promise<void> };
  private authTried = false;

  constructor(
    private readonly deps: OpRunDeps,
    private readonly network: boolean,
  ) {}

  /** Komutu çalıştırır; log'a "$ git …" ve çıktıyı yazar. Ağ komutunda kimlik hatası olursa bir kez token ile dener. */
  async git(args: string[]): Promise<string> {
    const opts = this.network ? { timeoutMs: NETWORK_TIMEOUT_MS } : {};
    try {
      const out = await this.exec(args, opts);
      this.record(out);
      return out;
    } catch (err) {
      if (this.network && err instanceof GitError && err.kind === 'auth' && !this.authEnv && !this.authTried) {
        this.authTried = true;
        const token = await this.deps.getToken?.();
        if (token) {
          this.record(err.stderr);
          this.deps.log(text().retryingWithGitHub);
          this.authEnv = await createAskpassEnv(token);
          try {
            const out = await this.exec(args, opts);
            this.record(out);
            return out;
          } catch (retryErr) {
            this.recordError(retryErr);
            throw retryErr;
          }
        }
      }
      this.recordError(err);
      throw err;
    }
  }

  /** Kayda girmeyen salt okunur yardımcı komut. */
  quiet(args: string[]): Promise<string> {
    return runGit(args, this.deps.root);
  }

  async dispose(): Promise<void> {
    await this.authEnv?.dispose().catch(() => undefined);
  }

  get detail(): string | undefined {
    const text = this.outputs.join('\n').trim();
    return text === '' ? undefined : text;
  }

  /** Komutu kaydeder ve çalıştırır. Askpass yedeğinde kimlik yardımcısı (ör. Git Credential Manager) kapatılır. */
  private exec(args: string[], opts: { timeoutMs?: number }): Promise<string> {
    const full = this.authEnv ? ['-c', 'credential.helper=', ...args] : args;
    const cmd = formatCommand(full);
    this.commands.push(cmd);
    this.deps.log(`$ ${cmd}`);
    return runGit(full, this.deps.root, this.authEnv ? { ...opts, env: this.authEnv.env } : opts);
  }

  private record(text: string): void {
    const t = text.trim();
    if (t === '') return;
    this.outputs.push(t);
    for (const line of t.split(/\r?\n/)) this.deps.log(line);
  }

  private recordError(err: unknown): void {
    if (err instanceof GitError) {
      this.record(err.stdout);
      this.record(err.stderr || err.message);
    } else if (err instanceof Error) {
      this.record(err.message);
    }
  }
}

/** Akış içinde kullanıcıya dönülecek sonuç (hata değil). */
class Outcome {
  constructor(
    readonly ok: boolean,
    readonly message: string,
    readonly cancelled = false,
  ) {}
}
const done = (message: string): Outcome => new Outcome(true, message);
const fail = (message: string): Outcome => new Outcome(false, message);
const cancelled = (message?: string): Outcome => new Outcome(false, message ?? text().cancelled, true);

export class GitOpsService {
  private readonly queue: OpQueue;

  constructor(
    private readonly deps: OpsDeps,
    queue?: OpQueue,
  ) {
    this.queue = queue ?? new OpQueue();
  }

  run(id: string, op: GitOpRequest, onStarted?: (commands: string[]) => void): Promise<OpResult> {
    return this.queue.run(() => this.runUnqueued(id, op, onStarted));
  }

  /**
   * İşlemi kuyruğa girmeden yürütür. Yalnızca aynı OpQueue'da zaten çalışan bir işin içinden
   * çağrılır (ör. GitHubOpsService'in PR öncesi push'u); aksi hâlde run() kullanılır.
   */
  async runUnqueued(id: string, op: GitOpRequest, onStarted?: (commands: string[]) => void): Promise<OpResult> {
    const run = new OpRun(this.deps, NETWORK_OPS.has(op.kind) || (op.kind === 'commit' && op.push));
    let outcome: Outcome;
    try {
      outcome = await this.flow(op, run, onStarted ?? (() => undefined));
    } catch (err) {
      outcome = fail(errorMessage(op, err));
    } finally {
      await run.dispose();
    }
    const result: OpResult = { id, kind: op.kind, ok: outcome.ok, commands: run.commands, message: outcome.message };
    if (outcome.cancelled) result.cancelled = true;
    const detail = run.detail;
    if (detail !== undefined) result.detail = detail;
    return result;
  }

  private async flow(op: GitOpRequest, run: OpRun, started: (commands: string[]) => void): Promise<Outcome> {
    const { ui } = this.deps;
    const t = text();
    const status = await getStatus(this.deps.root);
    const plan = async (): Promise<string[][]> => {
      const cmds = opCommands(op, status, await this.context(run));
      started(cmds.map(formatCommand));
      return cmds;
    };
    const runAll = async (cmds: string[][]): Promise<void> => {
      for (const c of cmds) await run.git(c);
    };

    switch (op.kind) {
      case 'stage':
      case 'unstage':
      case 'markResolved': {
        if (op.paths.length === 0) return fail(t.noFilesSelected);
        await runAll(await plan());
        const n = op.paths.length;
        if (op.kind === 'stage') return done(t.staged(n));
        if (op.kind === 'unstage') return done(t.unstaged(n));
        return done(t.markedResolved(n));
      }

      case 'resolveSide': {
        const file = status.files.find((f) => f.path === op.path && f.conflicted);
        if (!file) return fail(t.notConflicted(op.path));
        const other: ConflictSide = op.side === 'ours' ? 'theirs' : 'ours';
        const role = t.sideRole(sideRole(status.operation, op.side));
        const otherRole = t.sideRole(sideRole(status.operation, other));
        const exists = sideExists(file.conflict, op.side);
        const ok = exists
          ? await ui.confirm(t.resolveSideConfirm(op.path, role), t.resolveSideDetail(otherRole), t.resolveSideAction)
          : await ui.confirm(t.resolveSideDeleteConfirm(op.path), t.resolveSideDetail(otherRole), t.resolveSideDeleteAction);
        if (!ok) return cancelled();
        await runAll(await plan());
        return done(exists ? t.resolvedWithSide(op.path, role) : t.resolvedByDelete(op.path));
      }

      case 'bisectStart': {
        if (await getBisectState(this.deps.root)) return fail(t.bisectAlreadyActive);
        const dirty = status.files.some(
          (f) => f.conflicted || f.staged !== undefined || (f.unstaged !== undefined && f.unstaged !== 'untracked'),
        );
        if (dirty) {
          const ok = await ui.confirm(t.bisectDirtyConfirm, t.bisectDirtyDetail, t.bisectStashAction);
          if (!ok) return cancelled();
          await run.git(['stash', 'push', '-m', 'GitAtlas-Rev: bisect']);
        }
        await runAll(await plan());
        return done(await this.bisectProgress(run));
      }

      case 'bisectMark': {
        if (!(await getBisectState(this.deps.root))) return fail(t.bisectNotActive);
        await runAll(await plan());
        return done(await this.bisectProgress(run));
      }

      case 'bisectReset': {
        const state = await getBisectState(this.deps.root);
        if (!state) return fail(t.bisectNotActive);
        await runAll(await plan());
        return done(t.bisectResetDone(state.startRef));
      }

      case 'stageAll': {
        const n = status.files.filter((f) => f.unstaged !== undefined).length;
        if (n === 0) return done(t.nothingToStage);
        await runAll(await plan());
        return done(t.staged(n));
      }

      case 'unstageAll': {
        const n = status.files.filter((f) => f.staged !== undefined).length;
        if (n === 0) return done(t.nothingStaged);
        await runAll(await plan());
        return done(t.unstaged(n));
      }

      case 'discard': {
        if (op.paths.length === 0) return fail(t.noFilesSelected);
        const untracked = new Set(status.files.filter((f) => f.unstaged === 'untracked').map((f) => f.path));
        const fresh = op.paths.filter((p) => untracked.has(p)).length;
        const lines = [op.paths.slice(0, 10).join('\n') + (op.paths.length > 10 ? t.discardMore(op.paths.length - 10) : '')];
        if (fresh > 0) lines.push(t.discardUntracked(fresh));
        lines.push(t.cannotUndo);
        const ok = await ui.confirm(t.discardConfirm(op.paths.length), lines.join('\n\n'), t.discardAction);
        if (!ok) return cancelled();
        await runAll(await plan());
        return done(t.discarded(op.paths.length));
      }

      case 'commit':
        return this.commit(op, status, run, plan);

      case 'undoLastCommit': {
        const last = status.lastCommit;
        if (!last) return fail(t.noCommitToUndo);
        if (last.pushed) {
          const ok = await ui.confirm(t.undoPushedConfirm, t.undoPushedDetail(`${last.shortHash} ${last.message}`), t.undoAction);
          if (!ok) return cancelled();
        }
        await runAll(await plan());
        return done(t.undone(`${last.shortHash} ${last.message}`));
      }

      case 'fetch': {
        await runAll(await plan());
        const after = await getStatus(this.deps.root);
        if (after.upstream && after.behind > 0) {
          return done(t.fetchedBehind(after.upstream, after.behind));
        }
        return done(t.fetchedUpToDate);
      }

      case 'pull':
        return this.pull(op, status, run, plan);

      case 'push':
        return this.push(op.force === true, status, run, plan);

      case 'checkout': {
        if (op.branch === status.branch) return done(t.alreadyOnBranch(op.branch));
        const cmds = await plan();
        try {
          await runAll(cmds);
        } catch (err) {
          if (!(err instanceof GitError && err.kind === 'dirtyTree')) throw err;
          const choice = await ui.pick(t.dirtyBlocksSwitch(op.branch), [
            { id: 'stash', label: t.stashAndSwitch, detail: t.stashAndSwitchDetail },
            { id: 'cancel', label: t.cancel },
          ]);
          if (choice !== 'stash') return cancelled();
          await run.git(['stash', 'push', '-u', '-m', t.stashMessageBeforeSwitch(op.branch)]);
          await runAll(cmds);
          return done(t.switchedStashed(op.branch));
        }
        return done(t.switched(op.branch));
      }

      case 'createBranch': {
        if (!isValidBranchName(op.name)) return fail(invalidBranchMessage(op.name));
        try {
          await runAll(await plan());
        } catch (err) {
          if (err instanceof GitError && /already exists/i.test(err.stderr)) return fail(t.branchExists(op.name));
          throw err;
        }
        return done(op.checkout ? t.branchCreatedSwitched(op.name) : t.branchCreated(op.name));
      }

      case 'mergeBranch': {
        let out = '';
        for (const c of await plan()) out += await run.git(c);
        if (/Already up to date/i.test(out)) return done(t.mergeUpToDate(op.branch));
        return done(t.merged(op.branch, status.branch ?? 'HEAD'));
      }

      case 'renameBranch': {
        if (!isValidBranchName(op.to)) return fail(invalidBranchMessage(op.to));
        try {
          await runAll(await plan());
        } catch (err) {
          if (err instanceof GitError && /already exists/i.test(err.stderr)) return fail(t.branchExists(op.to));
          throw err;
        }
        return done(t.renamed(op.from, op.to));
      }

      case 'deleteBranch': {
        if (op.name === status.branch) return fail(t.cannotDeleteCurrent);
        const ok = await ui.confirm(t.deleteBranchConfirm(op.name), t.deleteBranchDetail, t.deleteAction);
        if (!ok) return cancelled();
        try {
          await runAll(await plan());
        } catch (err) {
          if (!(err instanceof GitError && /not fully merged/i.test(err.stderr))) throw err;
          const force = await ui.confirm(t.unmergedConfirm(op.name), t.unmergedDetail, t.forceDeleteAction);
          if (!force) return cancelled();
          await run.git(['branch', '-D', op.name]);
        }
        return done(t.branchDeleted(op.name));
      }

      case 'stashSave': {
        const any = status.files.some((f) => f.staged !== undefined || (f.unstaged !== undefined && (op.includeUntracked || f.unstaged !== 'untracked')));
        if (!any) return fail(op.includeUntracked ? t.nothingToStash : t.nothingToStashUntracked);
        await runAll(await plan());
        return done(t.stashed);
      }

      case 'stashApply': {
        const ref = `stash@{${op.index}}`;
        try {
          await runAll(await plan());
        } catch (err) {
          if (err instanceof GitError && err.kind === 'conflict') {
            return fail(t.stashApplyConflict(ref));
          }
          throw err;
        }
        return done(op.pop ? t.stashPopped(ref) : t.stashApplied(ref));
      }

      case 'stashDrop': {
        const ref = `stash@{${op.index}}`;
        const entry = (await listStashes(this.deps.root)).find((s) => s.index === op.index);
        const ok = await ui.confirm(t.stashDropConfirm(ref), entry ? entry.message : t.cannotUndo, t.deleteAction);
        if (!ok) return cancelled();
        await runAll(await plan());
        return done(t.stashDropped(ref));
      }

      case 'cherryPick': {
        if (op.hashes.length === 0) return fail(t.noCommitsSelected);
        if (status.operation) return fail(t.cherryPickBusy(OPERATION_LABEL[status.operation]));
        // git kirli ağaçta zaten reddeder; mesajı anlaşılır yapalım (untracked dosya engel değil).
        const dirty = status.files.some(
          (f) => f.staged !== undefined || (f.unstaged !== undefined && f.unstaged !== 'untracked'),
        );
        if (dirty) return fail(t.cherryPickDirty);
        const branch = status.branch ?? 'HEAD';
        if (op.hashes.length > 1) {
          const ok = await ui.confirm(t.cherryPickConfirm(op.hashes.length), t.cherryPickDetail(branch), t.cherryPickAction);
          if (!ok) return cancelled();
        }
        try {
          await runAll(await plan());
        } catch (err) {
          // Çakışmada git durur; bant devreye girer, kullanıcı çözüp Devam et der.
          if (err instanceof GitError && err.kind === 'conflict') return fail(t.cherryPickStopped);
          throw err;
        }
        return done(t.cherryPicked(op.hashes.length, branch));
      }

      case 'continueOperation': {
        if (!status.operation) return fail(t.noOperationToContinue);
        const label = OPERATION_LABEL[status.operation];
        await runAll(await plan());
        const after = await getStatus(this.deps.root);
        if (after.operation === status.operation) return done(t.operationContinues(label));
        return done(t.operationDone(label));
      }

      case 'skipOperation': {
        if (!status.operation) return fail(t.noOperationToSkip);
        const label = OPERATION_LABEL[status.operation];
        // merge'de --skip yok; diğerlerinde (rebase, cherry-pick, revert) var.
        if (status.operation === 'merge') return fail(t.cannotSkip(label));
        await runAll(await plan());
        const after = await getStatus(this.deps.root);
        if (after.operation === status.operation) return done(t.skipped(label));
        return done(t.operationDone(label));
      }

      case 'abortOperation': {
        if (!status.operation) return fail(t.noOperationToAbort);
        const label = OPERATION_LABEL[status.operation];
        const ok = await ui.confirm(t.abortConfirm(label), t.abortDetail, t.abortAction);
        if (!ok) return cancelled();
        await runAll(await plan());
        return done(t.aborted(label));
      }
    }
  }

  /** Bisect adımından sonra: bulundu / sıradaki test / iyi-kötü bekleniyor. */
  private async bisectProgress(run: OpRun): Promise<string> {
    const t = text();
    const state = await getBisectState(this.deps.root);
    const describe = async (hash: string): Promise<string> =>
      (await run.quiet(['log', '-1', '--format=%h %s', hash]).catch(() => hash.slice(0, 7))).trim();
    if (!state) return t.bisectWaiting;
    if (state.firstBad) return t.bisectFound(await describe(state.firstBad));
    if (!state.bad || state.goods.length === 0 || !state.current) return t.bisectWaiting;
    return t.bisectTesting(await describe(state.current), state.steps);
  }

  private async commit(
    op: Extract<GitOpRequest, { kind: 'commit' }>,
    status: WorkingTreeStatus,
    run: OpRun,
    plan: () => Promise<string[][]>,
  ): Promise<Outcome> {
    const t = text();
    const summary = op.message.trim();
    if (!op.amend && summary === '') return fail(t.emptyCommitMessage);
    if (op.amend && !status.lastCommit) return fail(t.noCommitToAmend);
    if (!op.amend && !status.files.some((f) => f.staged !== undefined)) {
      return fail(t.nothingStagedForCommit);
    }
    if (op.amend && status.lastCommit?.pushed) {
      const ok = await this.deps.ui.confirm(
        t.amendPushedConfirm,
        t.amendPushedDetail(`${status.lastCommit.shortHash} ${status.lastCommit.message}`),
        t.amendAction,
      );
      if (!ok) return cancelled();
    }

    const [commitCmd, ...rest] = await plan();
    if (!commitCmd) return fail(t.commitFailed);
    try {
      await run.git(commitCmd);
    } catch (err) {
      const hook = err instanceof GitError && err.code === 'failed' && !err.kind ? await this.failedHook() : undefined;
      if (hook) return fail(t.hookStopped(hook));
      throw err;
    }
    const [hash = '', subject = ''] = (await run.quiet(['log', '-1', '--format=%h%x1f%s'])).trim().split('\x1f');
    const made = op.amend ? t.amended(`${hash} ${subject}`) : t.committed(`${hash} ${subject}`);
    if (!op.push || rest.length === 0) return done(`${made}.`);

    const after = await getStatus(this.deps.root);
    const pushed = await this.push(false, after, run, async () => rest);
    return new Outcome(pushed.ok, `${made}. ${pushed.message}`, pushed.cancelled);
  }

  private async pull(
    op: Extract<GitOpRequest, { kind: 'pull' }>,
    status: WorkingTreeStatus,
    run: OpRun,
    plan: () => Promise<string[][]>,
  ): Promise<Outcome> {
    const t = text();
    if (!status.branch) return fail(t.pullDetached);
    if (!status.upstream) return fail(t.noUpstream);
    const before = status.head;
    let strategy = op.strategy;

    try {
      await run.git((await plan())[0] ?? ['pull', '--ff-only']);
    } catch (err) {
      if (op.strategy !== undefined || !(err instanceof GitError && err.kind === 'nonFastForward')) {
        return this.pullError(err);
      }
      const pref = this.deps.pullStrategy();
      let chosen: 'merge' | 'rebase' | undefined;
      if (pref === 'ask') {
        const pick = await this.deps.ui.pick(t.divergedPick, [
          { id: 'merge', label: 'Merge', detail: t.mergeStrategyDetail },
          { id: 'rebase', label: 'Rebase', detail: t.rebaseStrategyDetail },
          { id: 'cancel', label: t.cancel },
        ]);
        chosen = pick === 'merge' || pick === 'rebase' ? pick : undefined;
      } else {
        chosen = pref;
      }
      if (!chosen) return cancelled(t.diverged);
      strategy = chosen;
      try {
        await run.git(chosen === 'merge' ? ['pull', '--no-rebase'] : ['pull', '--rebase']);
      } catch (err2) {
        return this.pullError(err2);
      }
    }

    const head = (await run.quiet(['rev-parse', 'HEAD'])).trim();
    if (head === before) return done(t.upToDate);
    if (strategy === 'merge') return done(t.pullMerged(status.upstream, status.branch));
    if (strategy === 'rebase') return done(t.pullRebased(status.upstream));
    const n = Number((await run.quiet(['rev-list', '--count', `${before ?? head}..${head}`])).trim());
    return done(t.pulled(n));
  }

  private pullError(err: unknown): Outcome {
    if (err instanceof GitError) {
      if (err.kind === 'conflict') return fail(text().conflict);
      if (err.kind === 'dirtyTree') return fail(text().pullDirty);
    }
    throw err;
  }

  private async push(force: boolean, status: WorkingTreeStatus, run: OpRun, plan: () => Promise<string[][]>): Promise<Outcome> {
    const t = text();
    const branch = status.branch;
    if (!branch) return fail(t.pushDetached);
    if (force) {
      const ok = await this.deps.ui.confirm(t.forcePushConfirm(branch), t.forcePushDetail, t.forcePushAction);
      if (!ok) return cancelled();
    }
    if (!force && status.upstream && status.ahead === 0) return done(t.nothingToPush(status.upstream));

    const count = status.upstream
      ? status.ahead
      : Number((await run.quiet(['rev-list', '--count', 'HEAD', '--not', '--remotes'])).trim()) || 0;
    const cmds = await plan();
    try {
      for (const c of cmds) await run.git(c);
    } catch (err) {
      if (err instanceof GitError && err.kind === 'noUpstream') {
        await run.git(['push', '-u', ...(force ? ['--force-with-lease'] : []), 'origin', branch]);
        return done(t.pushedTracking(branch, count));
      }
      if (err instanceof GitError && err.kind === 'nonFastForward') {
        return fail(force ? t.forcePushStopped : t.rejected);
      }
      throw err;
    }
    if (!status.upstream) return done(t.pushedTracking(branch, count));
    return done(force ? t.forcePushed(status.upstream, count) : t.pushed(status.upstream, count));
  }

  /** Başarısız commit'te hangi hook'un çalıştığını bulur (pre-commit öncelikli). */
  private async failedHook(): Promise<string | undefined> {
    for (const hook of ['pre-commit', 'commit-msg']) {
      try {
        const p = (await runGit(['rev-parse', '--git-path', `hooks/${hook}`], this.deps.root)).trim();
        if (existsSync(isAbsolute(p) ? p : join(this.deps.root, p))) return hook;
      } catch {
        // yok say
      }
    }
    return undefined;
  }

  private async context(run: OpRun): Promise<{ localBranches: string[]; remotes: string[] }> {
    const [heads, remotes] = await Promise.all([
      run.quiet(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).catch(() => ''),
      run.quiet(['remote']).catch(() => ''),
    ]);
    const lines = (s: string): string[] => s.split(/\r?\n/).filter((l) => l !== '');
    const r = lines(remotes);
    return { localBranches: lines(heads), remotes: r.length > 0 ? r : ['origin'] };
  }
}

function invalidBranchMessage(name: string): string {
  return text().invalidBranch(name);
}

function errorMessage(op: GitOpRequest, err: unknown): string {
  const t = text();
  if (!(err instanceof GitError)) return t.opFailedWith(op.kind, err instanceof Error ? err.message : String(err));
  if (err.code !== 'failed') return err.message;
  switch (err.kind) {
    case 'auth':
      return t.auth;
    case 'network':
      return t.network;
    case 'conflict':
      return t.conflict;
    case 'dirtyTree':
      return t.dirtyTree;
    case 'nonFastForward':
      return t.rejected;
    case 'noUpstream':
      return t.noUpstream;
  }
  if (err.timedOut) return t.opFailedWith(op.kind, err.message);
  return t.opFailedSeeOutput(op.kind);
}
