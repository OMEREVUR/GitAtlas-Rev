// PR açma / birleştirme / checkout akışları. VS Code'dan bağımsız; git adımları GitOpsService ile
// aynı OpQueue içinde tek iş olarak yürür. Token yalnızca API çağrısına ve askpass ortamına gider.
import { GitError, runGit } from '../git/gitRunner';
import { formatCommand, opCommands } from '../git/opCommands';
import { prCheckoutCommands } from '../git/prCheckout';
import { getStatus } from '../git/status';
import { GitHubApiError } from '../github/graphql';
import { createPullRequest, deleteRemoteBranch, mergePullRequest } from '../github/prApi';
import { text } from '../i18n/ops';
import type { GitHubOpRequest, GitOpRequest, OpResult, PullRequestDetail } from '../types';
import { OpRun, type GitOpsService, type OpsUi } from './gitOpsService';
import type { OpQueue } from './opQueue';

export interface GitHubOpsDeps {
  root: string;
  ui: OpsUi;
  /** Aynı queue ile kurulmuş olmalı. */
  gitOps: GitOpsService;
  queue: OpQueue;
  coords: () => { owner: string; repo: string } | undefined;
  getToken: () => Promise<string | undefined>;
  fetchFn: typeof fetch;
  log: (line: string) => void;
  getPr: (n: number) => PullRequestDetail | undefined;
  defaultBranch: () => string | undefined;
}

// Kullanıcıya görünen metinler src/i18n/ops.ts sözlüğünden gelir.

const METHOD_LABEL = { merge: 'merge', squash: 'squash', rebase: 'rebase' } as const;

/** Tek bir GitHub işleminin biriktirdiği komutlar ve çıktılar. */
class Trace {
  readonly commands: string[] = [];
  readonly details: string[] = [];

  constructor(private readonly log: (line: string) => void) {}

  /** Okunabilir GitHub adımı ("GitHub: PR oluştur (feature → main)"). */
  step(line: string): void {
    this.commands.push(line);
    this.log(line);
  }

  absorb(r: { commands: string[]; detail?: string }): void {
    this.commands.push(...r.commands);
    if (r.detail) this.details.push(r.detail);
  }

  note(text: string): void {
    if (text.trim() !== '') this.details.push(text.trim());
  }
}

class Outcome {
  constructor(
    readonly ok: boolean,
    readonly message: string,
    readonly cancelled = false,
  ) {}
}
const done = (m: string): Outcome => new Outcome(true, m);
const fail = (m: string): Outcome => new Outcome(false, m);
const cancelled = (): Outcome => new Outcome(false, text().cancelled, true);

function apiMessage(err: unknown): string {
  if (err instanceof GitHubApiError) return err.kind === 'unauthorized' ? text().ghUnauthorized : err.message;
  return err instanceof Error ? err.message : String(err);
}

function gitMessage(err: unknown): string {
  if (!(err instanceof GitError)) return err instanceof Error ? err.message : String(err);
  if (err.code !== 'failed') return err.message;
  const t = text();
  switch (err.kind) {
    case 'auth':
      return t.auth;
    case 'network':
      return t.network;
    case 'dirtyTree':
      return t.ghDirtyTree;
    case 'nonFastForward':
      return t.ghNonFastForward;
  }
  if (err.timedOut) return err.message;
  return t.prCheckoutFailed;
}

export class GitHubOpsService {
  constructor(private readonly deps: GitHubOpsDeps) {}

  run(id: string, op: GitHubOpRequest, onStarted?: (commands: string[]) => void): Promise<OpResult> {
    return this.deps.queue.run(() => this.execute(id, op, onStarted ?? (() => undefined)));
  }

  private async execute(id: string, op: GitHubOpRequest, started: (commands: string[]) => void): Promise<OpResult> {
    const trace = new Trace(this.deps.log);
    let outcome: Outcome;
    try {
      const coords = this.deps.coords();
      const token = coords ? await this.deps.getToken() : undefined;
      if (!coords || !token) {
        outcome = fail(text().ghNotConnected);
      } else if (op.kind === 'createPr') {
        outcome = await this.createPr(id, op, coords, token, trace, started);
      } else if (op.kind === 'mergePr') {
        outcome = await this.mergePr(id, op, coords, token, trace, started);
      } else {
        outcome = await this.checkoutPr(op, trace, started);
      }
    } catch (err) {
      if (err instanceof GitHubApiError) {
        // Genel "oturum geçersiz" mesajının yanında GitHub'ın asıl nedeni (ör. SSO izni) ayrıntıda kalır.
        if (err.kind === 'unauthorized') trace.note(err.message);
        outcome = fail(apiMessage(err));
      } else {
        outcome = fail(gitMessage(err));
      }
    }
    const result: OpResult = { id, kind: op.kind, ok: outcome.ok, commands: trace.commands, message: outcome.message };
    if (outcome.cancelled) result.cancelled = true;
    const detail = trace.details.join('\n').trim();
    if (detail !== '') result.detail = detail;
    return result;
  }

  /** GitOpsService işlemini (zaten kuyruktayız) kuyruğa girmeden yürütür ve izine ekler. */
  private async git(id: string, op: GitOpRequest, trace: Trace): Promise<OpResult> {
    const r = await this.deps.gitOps.runUnqueued(id, op);
    trace.absorb(r);
    return r;
  }

  private async createPr(
    id: string,
    op: Extract<GitHubOpRequest, { kind: 'createPr' }>,
    coords: { owner: string; repo: string },
    token: string,
    trace: Trace,
    started: (commands: string[]) => void,
  ): Promise<Outcome> {
    const t = text();
    const title = op.title.trim();
    if (title === '') return fail(t.emptyPrTitle);
    const status = await getStatus(this.deps.root);
    const branch = status.branch;
    if (!branch) return fail(t.prNeedsBranch);
    const base = op.base.trim() || this.deps.defaultBranch() || 'main';
    // Upstream origin'deyse uzak adı kullan (yerel adla farklı olabilir).
    const head = status.upstream?.startsWith('origin/') ? status.upstream.slice('origin/'.length) : branch;
    if (head === base) return fail(t.samePrBranch(base));

    const needsPush = status.upstream === undefined || status.ahead > 0;
    const pushCmd = formatCommand(opCommands({ kind: 'push' }, status)[0] ?? ['push']);
    const apiStep = t.stepCreatePr(head, base);

    if (needsPush) {
      const ok = await this.deps.ui.confirm(t.pushBeforePrConfirm, pushCmd, t.pushAndOpenPrAction);
      if (!ok) return cancelled();
    }
    started(needsPush ? [pushCmd, apiStep] : [apiStep]);

    if (needsPush) {
      const pushed = await this.git(id, { kind: 'push' }, trace);
      if (!pushed.ok) return fail(t.prNotOpened(pushed.message));
    }

    trace.step(apiStep);
    const pr = await createPullRequest(token, coords.owner, coords.repo, { title, body: op.body, head, base, draft: op.draft }, this.deps.fetchFn);
    this.deps.log(`PR #${pr.number}: ${pr.url}`);
    trace.note(pr.url);
    return done(op.draft ? t.draftPrOpened(pr.number, title) : t.prOpened(pr.number, title));
  }

  private async mergePr(
    id: string,
    op: Extract<GitHubOpRequest, { kind: 'mergePr' }>,
    coords: { owner: string; repo: string },
    token: string,
    trace: Trace,
    started: (commands: string[]) => void,
  ): Promise<Outcome> {
    const t = text();
    const pr = this.deps.getPr(op.number);
    if (!pr) return fail(t.prNotFound(op.number));
    const method = METHOD_LABEL[op.method];
    const deleteRemote = op.deleteBranch && !pr.isCrossRepository;

    const detail = [`"${pr.title}"`, t.mergeDetailMethod(method, pr.baseRef)];
    if (deleteRemote) detail.push(t.mergeDetailDeleteBranch(pr.headRef));
    const ok = await this.deps.ui.confirm(t.mergePrConfirm(pr.number), detail.join('\n'), t.mergeAction);
    if (!ok) return cancelled();

    const mergeStep = t.stepMergePr(pr.number, method);
    const deleteStep = t.stepDeleteRemoteBranch(pr.headRef);
    started([mergeStep, ...(deleteRemote ? [deleteStep] : []), 'git fetch --prune']);

    trace.step(mergeStep);
    const merged = await mergePullRequest(token, coords.owner, coords.repo, pr.number, op.method, this.deps.fetchFn);
    if (merged.sha) trace.note(t.mergeCommitNote(merged.sha));
    const parts = [t.prMerged(pr.number, method)];

    if (deleteRemote) {
      trace.step(deleteStep);
      try {
        await deleteRemoteBranch(token, coords.owner, coords.repo, pr.headRef, this.deps.fetchFn);
        parts.push(t.remoteBranchDeleted);
      } catch (err) {
        parts.push(t.remoteBranchNotDeleted(apiMessage(err)));
      }
    }

    const fetched = await this.git(id, { kind: 'fetch' }, trace);
    if (!fetched.ok) parts.push(t.fetchAfterMergeFailed(fetched.message));

    const status = await getStatus(this.deps.root);
    if (!pr.isCrossRepository && status.branch === pr.headRef && status.branch !== pr.baseRef) {
      const choice = await this.deps.ui.pick(t.onPrBranch(pr.headRef), [
        { id: 'switch', label: t.switchAndUpdate(pr.baseRef), detail: t.switchAndUpdateDetail },
        { id: 'stay', label: t.stayHere },
      ]);
      if (choice === 'switch') {
        const sw = await this.git(id, { kind: 'checkout', branch: pr.baseRef }, trace);
        if (!sw.ok) {
          parts.push(sw.cancelled ? t.notSwitched(pr.baseRef) : sw.message);
        } else {
          parts.push(sw.message);
          const after = await getStatus(this.deps.root);
          if (after.upstream) {
            const pulled = await this.git(id, { kind: 'pull', strategy: 'ff' }, trace);
            parts.push(pulled.ok ? pulled.message : t.notUpdated(pulled.message));
          }
        }
      }
    }
    return done(parts.join(' '));
  }

  private async checkoutPr(op: Extract<GitHubOpRequest, { kind: 'checkoutPr' }>, trace: Trace, started: (commands: string[]) => void): Promise<Outcome> {
    const t = text();
    const pr = this.deps.getPr(op.number);
    if (!pr) return fail(t.prNotFound(op.number));
    const heads = await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], this.deps.root);
    const locals = heads.split(/\r?\n/).filter((l) => l !== '');
    const cmds = prCheckoutCommands(pr, locals);
    const local = pr.isCrossRepository ? `pr/${pr.number}` : pr.headRef;
    started(cmds.map(formatCommand));

    const run = new OpRun({ root: this.deps.root, getToken: this.deps.getToken, log: this.deps.log }, true);
    let stashed = false;
    try {
      for (const cmd of cmds) {
        try {
          await run.git(cmd);
        } catch (err) {
          if (!(cmd[0] === 'switch' && err instanceof GitError && err.kind === 'dirtyTree' && !stashed)) throw err;
          const choice = await this.deps.ui.pick(t.dirtyBlocksSwitch(local), [
            { id: 'stash', label: t.stashAndSwitch, detail: t.stashAndSwitchDetail },
            { id: 'cancel', label: t.cancel },
          ]);
          if (choice !== 'stash') return cancelled();
          await run.git(['stash', 'push', '-u', '-m', t.stashMessageBeforeSwitch(local)]);
          stashed = true;
          await run.git(cmd);
        }
      }
    } finally {
      trace.absorb({ commands: run.commands, ...(run.detail !== undefined ? { detail: run.detail } : {}) });
      await run.dispose();
    }
    const msg = t.switchedToPr(local, pr.number);
    return done(stashed ? `${msg} ${t.stashedNote}` : msg);
  }
}
