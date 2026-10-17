// Webview'dan gelen git işlemlerini sırayla, onaylarıyla ve Türkçe sonuç mesajlarıyla yürütür.
// VS Code'dan bağımsızdır: diyaloglar OpsUi, kimlik GetToken üzerinden gelir.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createAskpassEnv } from '../git/askpass';
import { GitError, runGit } from '../git/gitRunner';
import { formatCommand, isValidBranchName, opCommands } from '../git/opCommands';
import { getStatus, listStashes } from '../git/status';
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

const MSG_CANCELLED = 'İptal edildi.';
const MSG_CONFLICT = "Çakışma var: dosyaları çözüp 'Çözüldü' deyin ya da işlemi iptal edin.";
const MSG_AUTH = "Kimlik doğrulama başarısız. Git kimlik bilgilerinizi ayarlayın ya da RewiewRev'de GitHub'a bağlanın.";
const MSG_NETWORK = 'Uzak depoya ulaşılamadı. İnternet bağlantınızı ve uzak deponun adresini kontrol edin.';
const MSG_DIRTY = 'Commit edilmemiş değişiklikler bu işlemle çakışıyor. Önce commit oluşturun ya da değişiklikleri saklayın (stash).';
const MSG_REJECTED = "Uzakta yeni commit'ler var; önce Çek (pull) yapın.";
const MSG_DIVERGED = 'Pull yapılamadı: yerel ve uzak branch ayrışmış. Merge ya da rebase seçin.';

const OPERATION_LABEL: Record<RepoOperation, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  cherryPick: 'Cherry-pick',
  revert: 'Revert',
};

// Mesajlarda ref adlarına Türkçe ek getirilmez ("master'e" gibi yanlış ekler çıkar); ad ayrı yazılır.

const plural = (n: number, word: string): string => `${n} ${word}`;

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
          this.deps.log('GitHub oturumuyla yeniden deneniyor…');
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
const cancelled = (message = MSG_CANCELLED): Outcome => new Outcome(false, message, true);

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
        if (op.paths.length === 0) return fail('Dosya seçilmedi.');
        await runAll(await plan());
        const n = op.paths.length;
        if (op.kind === 'stage') return done(`${plural(n, 'dosya')} commit'e eklendi.`);
        if (op.kind === 'unstage') return done(`${plural(n, 'dosya')} commit'ten çıkarıldı.`);
        return done(`${plural(n, 'dosya')} çözüldü olarak işaretlendi.`);
      }

      case 'stageAll': {
        const n = status.files.filter((f) => f.unstaged !== undefined).length;
        if (n === 0) return done("Commit'e eklenecek değişiklik yok.");
        await runAll(await plan());
        return done(`${plural(n, 'dosya')} commit'e eklendi.`);
      }

      case 'unstageAll': {
        const n = status.files.filter((f) => f.staged !== undefined).length;
        if (n === 0) return done("Commit'e eklenmiş dosya yok.");
        await runAll(await plan());
        return done(`${plural(n, 'dosya')} commit'ten çıkarıldı.`);
      }

      case 'discard': {
        if (op.paths.length === 0) return fail('Dosya seçilmedi.');
        const untracked = new Set(status.files.filter((f) => f.unstaged === 'untracked').map((f) => f.path));
        const fresh = op.paths.filter((p) => untracked.has(p)).length;
        const lines = [op.paths.slice(0, 10).join('\n') + (op.paths.length > 10 ? `\n… ve ${op.paths.length - 10} dosya daha` : '')];
        if (fresh > 0) lines.push(`Henüz eklenmemiş (untracked) ${plural(fresh, 'dosya')} diskten silinecek.`);
        lines.push('Bu işlem geri alınamaz.');
        const ok = await ui.confirm(
          `${plural(op.paths.length, 'dosyadaki')} değişiklik kalıcı olarak silinecek.`,
          lines.join('\n\n'),
          'Geri al',
        );
        if (!ok) return cancelled();
        await runAll(await plan());
        return done(`${plural(op.paths.length, 'dosyadaki')} değişiklik geri alındı.`);
      }

      case 'commit':
        return this.commit(op, status, run, plan);

      case 'undoLastCommit': {
        const last = status.lastCommit;
        if (!last) return fail('Geri alınacak commit yok.');
        if (last.pushed) {
          const ok = await ui.confirm(
            'Bu commit zaten gönderildi; geri almak geçmişi değiştirir.',
            `${last.shortHash} ${last.message}\n\nDeğişiklikler kaybolmaz, commit'e eklenmiş olarak kalır. Uzaktaki kopya değişmez; sonra yeniden göndermek için zorla gönderme gerekir.`,
            'Geri al',
          );
          if (!ok) return cancelled();
        }
        await runAll(await plan());
        return done(`Son commit geri alındı: ${last.shortHash} ${last.message}. Değişiklikler commit'e eklenmiş olarak duruyor.`);
      }

      case 'fetch': {
        await runAll(await plan());
        const after = await getStatus(this.deps.root);
        if (after.upstream && after.behind > 0) {
          return done(`Uzaktan güncellemeler alındı: ${after.upstream} ${after.behind} commit ileride; Çek (pull) ile alabilirsiniz.`);
        }
        return done('Uzaktan güncellemeler alındı; branch güncel.');
      }

      case 'pull':
        return this.pull(op, status, run, plan);

      case 'push':
        return this.push(op.force === true, status, run, plan);

      case 'checkout': {
        if (op.branch === status.branch) return done(`Zaten bu branch'tesiniz: ${op.branch}.`);
        const cmds = await plan();
        try {
          await runAll(cmds);
        } catch (err) {
          if (!(err instanceof GitError && err.kind === 'dirtyTree')) throw err;
          const choice = await ui.pick(`Commit edilmemiş değişiklikler geçişi engelliyor: ${op.branch}`, [
            { id: 'stash', label: 'Değişiklikleri sakla (stash) ve geç', detail: 'Değişiklikler stash listesine alınır; sonra geri uygulayabilirsiniz.' },
            { id: 'cancel', label: 'İptal' },
          ]);
          if (choice !== 'stash') return cancelled();
          await run.git(['stash', 'push', '-u', '-m', `RewiewRev: ${op.branch} geçişinden önce`]);
          await runAll(cmds);
          return done(`Geçildi: ${op.branch}. Değişiklikleriniz saklandı (stash@{0}).`);
        }
        return done(`Geçildi: ${op.branch}.`);
      }

      case 'createBranch': {
        if (!isValidBranchName(op.name)) return fail(invalidBranchMessage(op.name));
        try {
          await runAll(await plan());
        } catch (err) {
          if (err instanceof GitError && /already exists/i.test(err.stderr)) return fail(`"${op.name}" adında bir branch zaten var.`);
          throw err;
        }
        return done(op.checkout ? `Branch oluşturuldu ve geçildi: ${op.name}.` : `Branch oluşturuldu: ${op.name}.`);
      }

      case 'mergeBranch': {
        let out = '';
        for (const c of await plan()) out += await run.git(c);
        if (/Already up to date/i.test(out)) return done(`Zaten güncel: ${op.branch} içindeki her şey bu branch'te var.`);
        return done(`Birleştirildi: ${op.branch} → ${status.branch ?? 'HEAD'}.`);
      }

      case 'renameBranch': {
        if (!isValidBranchName(op.to)) return fail(invalidBranchMessage(op.to));
        try {
          await runAll(await plan());
        } catch (err) {
          if (err instanceof GitError && /already exists/i.test(err.stderr)) return fail(`"${op.to}" adında bir branch zaten var.`);
          throw err;
        }
        return done(`Branch adı değiştirildi: ${op.from} → ${op.to}.`);
      }

      case 'deleteBranch': {
        if (op.name === status.branch) return fail('Şu an bu branch\'tesiniz; silmek için önce başka bir branch\'e geçin.');
        const ok = await ui.confirm(`Branch silinecek: ${op.name}`, 'Uzaktaki kopyası (varsa) silinmez.', 'Sil');
        if (!ok) return cancelled();
        try {
          await runAll(await plan());
        } catch (err) {
          if (!(err instanceof GitError && /not fully merged/i.test(err.stderr))) throw err;
          const force = await ui.confirm(
            `Branch hiçbir yere birleştirilmemiş commit'ler içeriyor: ${op.name}`,
            'Silinirse bu commit\'ler kaybolabilir (git branch -D).',
            'Yine de sil',
          );
          if (!force) return cancelled();
          await run.git(['branch', '-D', op.name]);
        }
        return done(`Branch silindi: ${op.name}.`);
      }

      case 'stashSave': {
        const any = status.files.some((f) => f.staged !== undefined || (f.unstaged !== undefined && (op.includeUntracked || f.unstaged !== 'untracked')));
        if (!any) return fail(op.includeUntracked ? 'Saklanacak değişiklik yok.' : 'Saklanacak değişiklik yok (eklenmemiş yeni dosyalar için "yeni dosyalar dahil" seçin).');
        await runAll(await plan());
        return done('Değişiklikler saklandı (stash@{0}).');
      }

      case 'stashApply': {
        const ref = `stash@{${op.index}}`;
        try {
          await runAll(await plan());
        } catch (err) {
          if (err instanceof GitError && err.kind === 'conflict') {
            return fail(`${ref} uygulanırken çakışma çıktı; stash listede duruyor. Dosyaları çözüp 'Çözüldü' deyin.`);
          }
          throw err;
        }
        return done(op.pop ? `${ref} uygulandı ve listeden kaldırıldı.` : `${ref} uygulandı.`);
      }

      case 'stashDrop': {
        const ref = `stash@{${op.index}}`;
        const entry = (await listStashes(this.deps.root)).find((s) => s.index === op.index);
        const ok = await ui.confirm(`${ref} kalıcı olarak silinecek.`, entry ? entry.message : 'Bu işlem geri alınamaz.', 'Sil');
        if (!ok) return cancelled();
        await runAll(await plan());
        return done(`${ref} silindi.`);
      }

      case 'continueOperation': {
        if (!status.operation) return fail('Devam ettirilecek bir işlem yok.');
        const label = OPERATION_LABEL[status.operation];
        await runAll(await plan());
        const after = await getStatus(this.deps.root);
        if (after.operation === status.operation) return done(`${label} devam ediyor: sıradaki çakışmaları çözün.`);
        return done(`${label} tamamlandı.`);
      }

      case 'abortOperation': {
        if (!status.operation) return fail('İptal edilecek bir işlem yok.');
        const label = OPERATION_LABEL[status.operation];
        const ok = await ui.confirm(
          `Devam eden ${label.toLowerCase()} iptal edilecek.`,
          'Bu işlemdeki tüm değişiklikler (çakışma çözümleri dahil) geri alınır ve işlemden önceki duruma dönülür.',
          'İşlemi iptal et',
        );
        if (!ok) return cancelled();
        await runAll(await plan());
        return done(`${label} iptal edildi; önceki duruma dönüldü.`);
      }
    }
  }

  private async commit(
    op: Extract<GitOpRequest, { kind: 'commit' }>,
    status: WorkingTreeStatus,
    run: OpRun,
    plan: () => Promise<string[][]>,
  ): Promise<Outcome> {
    const summary = op.message.trim();
    if (!op.amend && summary === '') return fail('Commit mesajı boş olamaz.');
    if (op.amend && !status.lastCommit) return fail('Değiştirilecek bir commit yok.');
    if (!op.amend && !status.files.some((f) => f.staged !== undefined)) {
      return fail("Commit'e eklenmiş dosya yok — önce dosya seçin.");
    }
    if (op.amend && status.lastCommit?.pushed) {
      const ok = await this.deps.ui.confirm(
        'Bu commit zaten gönderildi; değiştirmek geçmişi değiştirir.',
        `${status.lastCommit.shortHash} ${status.lastCommit.message}\n\nDeğiştirdikten sonra göndermek için zorla gönderme (force push) gerekir.`,
        'Değiştir',
      );
      if (!ok) return cancelled();
    }

    const [commitCmd, ...rest] = await plan();
    if (!commitCmd) return fail('Commit oluşturulamadı.');
    try {
      await run.git(commitCmd);
    } catch (err) {
      const hook = err instanceof GitError && err.code === 'failed' && !err.kind ? await this.failedHook() : undefined;
      if (hook) return fail(`${hook} hook'u commit'i durdurdu.`);
      throw err;
    }
    const [hash = '', subject = ''] = (await run.quiet(['log', '-1', '--format=%h%x1f%s'])).trim().split('\x1f');
    const made = op.amend ? `Son commit değiştirildi: ${hash} ${subject}` : `Commit oluşturuldu: ${hash} ${subject}`;
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
    if (!status.branch) return fail('Ayrık HEAD (detached) durumunda çekilemez; önce bir branch\'e geçin.');
    if (!status.upstream) return fail("Bu branch'in uzak karşılığı (upstream) yok; önce Gönder (push) yapın.");
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
        const pick = await this.deps.ui.pick('Yerel ve uzak branch ayrışmış. Nasıl birleştirilsin?', [
          { id: 'merge', label: 'Merge', detail: 'Uzak commit\'leri bir merge commit\'iyle birleştirir.' },
          { id: 'rebase', label: 'Rebase', detail: 'Yerel commit\'lerinizi uzak commit\'lerin üstüne taşır.' },
          { id: 'cancel', label: 'İptal' },
        ]);
        chosen = pick === 'merge' || pick === 'rebase' ? pick : undefined;
      } else {
        chosen = pref;
      }
      if (!chosen) return cancelled(MSG_DIVERGED);
      strategy = chosen;
      try {
        await run.git(chosen === 'merge' ? ['pull', '--no-rebase'] : ['pull', '--rebase']);
      } catch (err2) {
        return this.pullError(err2);
      }
    }

    const head = (await run.quiet(['rev-parse', 'HEAD'])).trim();
    if (head === before) return done('Zaten güncel.');
    if (strategy === 'merge') return done(`Birleştirildi (merge): ${status.upstream} → ${status.branch}.`);
    if (strategy === 'rebase') return done(`Rebase yapıldı: yerel commit'ler ${status.upstream} üstüne taşındı.`);
    const n = Number((await run.quiet(['rev-list', '--count', `${before ?? head}..${head}`])).trim());
    return done(`${n} commit çekildi.`);
  }

  private pullError(err: unknown): Outcome {
    if (err instanceof GitError) {
      if (err.kind === 'conflict') return fail(MSG_CONFLICT);
      if (err.kind === 'dirtyTree') {
        return fail('Pull yapılamadı: commit edilmemiş değişiklikler var. Önce commit oluşturun ya da değişiklikleri saklayın (stash).');
      }
    }
    throw err;
  }

  private async push(force: boolean, status: WorkingTreeStatus, run: OpRun, plan: () => Promise<string[][]>): Promise<Outcome> {
    const branch = status.branch;
    if (!branch) return fail('Ayrık HEAD (detached) durumunda gönderilemez; önce bir branch\'e geçin.');
    if (force) {
      const ok = await this.deps.ui.confirm(
        `Zorla gönderilecek: ${branch}. Uzak branch'teki commit'lerin üzerine yazılır.`,
        '--force-with-lease kullanılır: bu arada başka biri göndermişse işlem durur ve hiçbir şey silinmez.',
        'Zorla gönder',
      );
      if (!ok) return cancelled();
    }
    if (!force && status.upstream && status.ahead === 0) return done(`Gönderilecek commit yok; ${status.upstream} güncel.`);

    const count = status.upstream
      ? status.ahead
      : Number((await run.quiet(['rev-list', '--count', 'HEAD', '--not', '--remotes'])).trim()) || 0;
    const cmds = await plan();
    try {
      for (const c of cmds) await run.git(c);
    } catch (err) {
      if (err instanceof GitError && err.kind === 'noUpstream') {
        await run.git(['push', '-u', ...(force ? ['--force-with-lease'] : []), 'origin', branch]);
        return done(`Gönderildi → origin/${branch} (${count} commit); takip ayarlandı.`);
      }
      if (err instanceof GitError && err.kind === 'nonFastForward') {
        return fail(force ? 'Zorla gönderme durduruldu: uzakta sizin görmediğiniz yeni commit\'ler var. Önce Al (fetch) yapın.' : MSG_REJECTED);
      }
      throw err;
    }
    if (!status.upstream) return done(`Gönderildi → origin/${branch} (${count} commit); takip ayarlandı.`);
    return done(`${force ? 'Zorla gönderildi' : 'Gönderildi'} → ${status.upstream} (${count} commit).`);
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
  return `Geçersiz branch adı: "${name}". Boşluk, ~ ^ : ? * [ \\ ve ".." kullanılamaz; "/" ile başlayıp bitemez.`;
}

const OP_LABEL: Record<GitOpRequest['kind'], string> = {
  stage: 'Dosyalar eklenemedi',
  stageAll: 'Dosyalar eklenemedi',
  unstage: "Dosyalar commit'ten çıkarılamadı",
  unstageAll: "Dosyalar commit'ten çıkarılamadı",
  discard: 'Değişiklikler geri alınamadı',
  commit: 'Commit oluşturulamadı',
  undoLastCommit: 'Son commit geri alınamadı',
  fetch: 'Uzaktan güncellemeler alınamadı',
  pull: 'Pull yapılamadı',
  push: 'Gönderilemedi',
  checkout: "Branch'e geçilemedi",
  createBranch: 'Branch oluşturulamadı',
  mergeBranch: 'Birleştirilemedi',
  renameBranch: 'Branch adı değiştirilemedi',
  deleteBranch: 'Branch silinemedi',
  stashSave: 'Değişiklikler saklanamadı',
  stashApply: 'Stash uygulanamadı',
  stashDrop: 'Stash silinemedi',
  markResolved: 'Dosyalar çözüldü olarak işaretlenemedi',
  continueOperation: 'İşleme devam edilemedi',
  abortOperation: 'İşlem iptal edilemedi',
};

function errorMessage(op: GitOpRequest, err: unknown): string {
  if (!(err instanceof GitError)) return `${OP_LABEL[op.kind]}: ${err instanceof Error ? err.message : String(err)}`;
  if (err.code !== 'failed') return err.message;
  switch (err.kind) {
    case 'auth':
      return MSG_AUTH;
    case 'network':
      return MSG_NETWORK;
    case 'conflict':
      return MSG_CONFLICT;
    case 'dirtyTree':
      return MSG_DIRTY;
    case 'nonFastForward':
      return MSG_REJECTED;
    case 'noUpstream':
      return "Bu branch'in uzak karşılığı (upstream) yok; önce Gönder (push) yapın.";
  }
  if (/zaman aşımı/.test(err.message)) return `${OP_LABEL[op.kind]}: ${err.message}`;
  return `${OP_LABEL[op.kind]}. Ayrıntı için çıktıya bakın.`;
}
