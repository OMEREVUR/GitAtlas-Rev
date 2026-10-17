// PR açma / birleştirme / checkout akışları. VS Code'dan bağımsız; git adımları GitOpsService ile
// aynı OpQueue içinde tek iş olarak yürür. Token yalnızca API çağrısına ve askpass ortamına gider.
import { GitError, runGit } from '../git/gitRunner';
import { formatCommand, opCommands } from '../git/opCommands';
import { prCheckoutCommands } from '../git/prCheckout';
import { getStatus } from '../git/status';
import { GitHubApiError } from '../github/graphql';
import { createPullRequest, deleteRemoteBranch, mergePullRequest } from '../github/prApi';
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

const MSG_NOT_CONNECTED = "GitHub'a bağlı değil — önce bağlanın.";
const MSG_UNAUTHORIZED = 'GitHub oturumu geçersiz — yeniden bağlanın.';
const MSG_DETACHED = "PR açmak için bir branch'te olmalısınız (şu an ayrık HEAD).";

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
const cancelled = (): Outcome => new Outcome(false, 'İptal edildi.', true);

function apiMessage(err: unknown): string {
  if (err instanceof GitHubApiError) return err.kind === 'unauthorized' ? MSG_UNAUTHORIZED : err.message;
  return err instanceof Error ? err.message : String(err);
}

function gitMessage(err: unknown): string {
  if (!(err instanceof GitError)) return err instanceof Error ? err.message : String(err);
  if (err.code !== 'failed') return err.message;
  switch (err.kind) {
    case 'auth':
      return "Kimlik doğrulama başarısız. Git kimlik bilgilerinizi ayarlayın ya da RewiewRev'de GitHub'a bağlanın.";
    case 'network':
      return 'Uzak depoya ulaşılamadı. İnternet bağlantınızı ve uzak deponun adresini kontrol edin.';
    case 'dirtyTree':
      return 'Commit edilmemiş değişiklikler geçişi engelliyor. Önce commit oluşturun ya da değişiklikleri saklayın (stash).';
    case 'nonFastForward':
      return "Yerel branch PR'ın branch'inden ayrışmış; ileri sarılamadı. Çek (pull) ile birleştirin.";
  }
  if (/zaman aşımı/.test(err.message)) return err.message;
  return "PR'ın branch'ine geçilemedi. Ayrıntı için çıktıya bakın.";
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
        outcome = fail(MSG_NOT_CONNECTED);
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
    const title = op.title.trim();
    if (title === '') return fail('PR başlığı boş olamaz.');
    const status = await getStatus(this.deps.root);
    const branch = status.branch;
    if (!branch) return fail(MSG_DETACHED);
    const base = op.base.trim() || this.deps.defaultBranch() || 'main';
    // Upstream origin'deyse uzak adı kullan (yerel adla farklı olabilir).
    const head = status.upstream?.startsWith('origin/') ? status.upstream.slice('origin/'.length) : branch;
    if (head === base) return fail(`PR'ın kaynağı ve hedefi aynı branch olamaz: ${base}`);

    const needsPush = status.upstream === undefined || status.ahead > 0;
    const pushCmd = formatCommand(opCommands({ kind: 'push' }, status)[0] ?? ['push']);
    const apiStep = `GitHub: PR oluştur (${head} → ${base})`;

    if (needsPush) {
      const ok = await this.deps.ui.confirm('PR açmadan önce branch gönderilsin mi?', pushCmd, 'Gönder ve PR aç');
      if (!ok) return cancelled();
    }
    started(needsPush ? [pushCmd, apiStep] : [apiStep]);

    if (needsPush) {
      const pushed = await this.git(id, { kind: 'push' }, trace);
      if (!pushed.ok) return fail(`PR açılmadı: ${pushed.message}`);
    }

    trace.step(apiStep);
    const pr = await createPullRequest(token, coords.owner, coords.repo, { title, body: op.body, head, base, draft: op.draft }, this.deps.fetchFn);
    this.deps.log(`PR #${pr.number}: ${pr.url}`);
    trace.note(pr.url);
    return done(`${op.draft ? 'Taslak PR açıldı' : 'PR açıldı'}: #${pr.number} ${title}`);
  }

  private async mergePr(
    id: string,
    op: Extract<GitHubOpRequest, { kind: 'mergePr' }>,
    coords: { owner: string; repo: string },
    token: string,
    trace: Trace,
    started: (commands: string[]) => void,
  ): Promise<Outcome> {
    const pr = this.deps.getPr(op.number);
    if (!pr) return fail(`PR #${op.number} bulunamadı; listeyi yenileyin.`);
    const method = METHOD_LABEL[op.method];
    const deleteRemote = op.deleteBranch && !pr.isCrossRepository;

    const detail = [`"${pr.title}"`, `Yöntem: ${method} · hedef: ${pr.baseRef}`];
    if (deleteRemote) detail.push(`Uzak branch silinecek: ${pr.headRef}`);
    const ok = await this.deps.ui.confirm(`PR #${pr.number} birleştirilsin mi?`, detail.join('\n'), 'Birleştir');
    if (!ok) return cancelled();

    const mergeStep = `GitHub: PR #${pr.number} birleştir (${method})`;
    const deleteStep = `GitHub: uzak branch'i sil (${pr.headRef})`;
    started([mergeStep, ...(deleteRemote ? [deleteStep] : []), 'git fetch --prune']);

    trace.step(mergeStep);
    const merged = await mergePullRequest(token, coords.owner, coords.repo, pr.number, op.method, this.deps.fetchFn);
    if (merged.sha) trace.note(`Birleştirme commit'i: ${merged.sha}`);
    const parts = [`PR #${pr.number} birleştirildi (${method}).`];

    if (deleteRemote) {
      trace.step(deleteStep);
      try {
        await deleteRemoteBranch(token, coords.owner, coords.repo, pr.headRef, this.deps.fetchFn);
        parts.push('Uzak branch silindi.');
      } catch (err) {
        parts.push(`Uzak branch silinemedi: ${apiMessage(err)}`);
      }
    }

    const fetched = await this.git(id, { kind: 'fetch' }, trace);
    if (!fetched.ok) parts.push(`Güncellemeler alınamadı: ${fetched.message}`);

    const status = await getStatus(this.deps.root);
    if (!pr.isCrossRepository && status.branch === pr.headRef && status.branch !== pr.baseRef) {
      const choice = await this.deps.ui.pick(`Şu an PR'ın branch'indesiniz: ${pr.headRef}`, [
        { id: 'switch', label: `Geç ve güncelle: ${pr.baseRef}`, detail: 'Hedef branch\'e geçer ve fast-forward ile günceller.' },
        { id: 'stay', label: 'Burada kal' },
      ]);
      if (choice === 'switch') {
        const sw = await this.git(id, { kind: 'checkout', branch: pr.baseRef }, trace);
        if (!sw.ok) {
          parts.push(sw.cancelled ? `Geçilmedi: ${pr.baseRef}.` : sw.message);
        } else {
          parts.push(sw.message);
          const after = await getStatus(this.deps.root);
          if (after.upstream) {
            const pulled = await this.git(id, { kind: 'pull', strategy: 'ff' }, trace);
            parts.push(pulled.ok ? pulled.message : `Güncellenemedi: ${pulled.message}`);
          }
        }
      }
    }
    return done(parts.join(' '));
  }

  private async checkoutPr(op: Extract<GitHubOpRequest, { kind: 'checkoutPr' }>, trace: Trace, started: (commands: string[]) => void): Promise<Outcome> {
    const pr = this.deps.getPr(op.number);
    if (!pr) return fail(`PR #${op.number} bulunamadı; listeyi yenileyin.`);
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
          const choice = await this.deps.ui.pick(`Commit edilmemiş değişiklikler geçişi engelliyor: ${local}`, [
            { id: 'stash', label: 'Değişiklikleri sakla (stash) ve geç', detail: 'Değişiklikler stash listesine alınır; sonra geri uygulayabilirsiniz.' },
            { id: 'cancel', label: 'İptal' },
          ]);
          if (choice !== 'stash') return cancelled();
          await run.git(['stash', 'push', '-u', '-m', `RewiewRev: ${local} geçişinden önce`]);
          stashed = true;
          await run.git(cmd);
        }
      }
    } finally {
      trace.absorb({ commands: run.commands, ...(run.detail !== undefined ? { detail: run.detail } : {}) });
      await run.dispose();
    }
    const msg = `Geçildi: ${local} (PR #${pr.number}).`;
    return done(stashed ? `${msg} Değişiklikleriniz saklandı (stash@{0}).` : msg);
  }
}
