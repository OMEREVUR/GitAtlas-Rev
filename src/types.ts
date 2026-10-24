// SÖZLEŞME — bu dosya yalnızca bilinçli bir kararla ve tüm kullanan yerler güncellenerek değiştirilir.
// Tüm tarihler milisaniye (Unix epoch). Tüm yollar repo köküne göre, "/" ayraçlı.

export interface CommitFileChange {
  /** Commit sonrasındaki yol. Yeniden adlandırmada yeni ad. */
  path: string;
  /** Yalnızca yeniden adlandırmada: commit öncesindeki yol. */
  oldPath?: string;
  /** Eklenen satır; binary dosyada 0. */
  added: number;
  /** Silinen satır; binary dosyada 0. */
  deleted: number;
}

export interface CommitSummary {
  hash: string;
  shortHash: string;
  /** Parent hash'leri (merge'de 2+). v2 commit graph'ı bunu kullanacak. */
  parents: string[];
  author: string;
  email: string;
  /** Yazar tarihi, ms. */
  date: number;
  /** Commit mesajının ilk satırı. */
  message: string;
  files: CommitFileChange[];
}

export type TimeRange = '7d' | '30d' | 'all';

export interface FileStat {
  path: string;
  /** Çalışma ağacındaki satır sayısı. */
  lines: number;
  /** Seçili aralıkta bu dosyaya dokunan commit sayısı (churn). */
  changes: number;
  /** Seçili aralıkta eklenen satır toplamı. */
  added: number;
  /** Seçili aralıkta silinen satır toplamı. */
  deleted: number;
  /** Bu dosyaya dokunan en son commit'in tarihi (tüm geçmiş), ms; hiç yoksa 0. */
  lastModified: number;
  /** Seçili aralıkta dokunan yazarlar (ad), en çok commit'ten aza. */
  authors: string[];
}

export interface RepoSnapshot {
  /** Repo kökü, mutlak yol. */
  root: string;
  /** Snapshot'ın işlendiği HEAD hash'i. */
  headHash: string;
  generatedAt: number;
  /** Tüm geçmiş, en yeniden en eskiye. */
  commits: CommitSummary[];
  /** İzlenen metin dosyalarının satır sayıları. Binary dosyalar burada yoktur. */
  lineCounts: Record<string, number>;
}

// ---- v2: commit graph + branch paneli ----

export type RefKind = 'local' | 'remote' | 'tag';

export interface GitRef {
  /** Kısa ad: 'main', 'origin/main', 'v1.0'. */
  name: string;
  /** Tam ad: 'refs/heads/main'. */
  fullName: string;
  kind: RefKind;
  /** Ref'in gösterdiği commit (etiketlerde soyulmuş commit). */
  hash: string;
  /** Şu an checkout edilmiş branch mi? */
  isHead: boolean;
  /** Yalnızca lokal branch'te: takip ettiği remote branch ('origin/main'). */
  upstream?: string;
  /** ahead/behind hangi ref'e göre hesaplandı (upstream ya da varsayılan branch). */
  compareTo?: string;
  ahead?: number;
  behind?: number;
  /** Uç commit'in committer tarihi, ms. */
  date: number;
  /** Uç commit'in mesajının ilk satırı. */
  subject: string;
  /** Uç commit'in yazarı. */
  author: string;
}

export interface GraphRow {
  hash: string;
  /** 0'dan başlayan şerit (sütun) indeksi. */
  lane: number;
  /** Renk indeksi 0..4 → --vscode-scmGraph-foreground1..5. */
  color: number;
  isMerge: boolean;
}

export interface GraphEdge {
  /** Renk indeksi 0..4. */
  color: number;
  /**
   * Çocuk commit'ten parent'a giden yol; satır merkezlerinden geçer.
   * Ardışık iki nokta ya aynı şeritte (düz çizgi) ya da komşu satırlarda farklı şeritlerdedir (S eğrisi).
   * Son noktanın row değeri rows.length ise parent yüklenmemiştir: çizgi alt kenara devam eder.
   */
  points: { row: number; lane: number }[];
}

export interface GraphLayout {
  rows: GraphRow[];
  edges: GraphEdge[];
  laneCount: number;
}

export interface GraphData {
  /** Tek branch'e süzüldüyse o branch'in adı; undefined = tüm branch'ler. */
  branch?: string;
  /** --topo-order, en yeniden en eskiye. */
  commits: CommitSummary[];
  /** commits ile aynı sırada. */
  layout: GraphLayout;
  /** Tüm lokal/remote branch'ler ve etiketler. */
  refs: GitRef[];
  /** HEAD'in commit hash'i (boş repoda yok). */
  head?: string;
  /** Checkout edilmiş branch adı (detached HEAD'de yok). */
  currentBranch?: string;
  /** İstenen en fazla commit sayısı. */
  limit: number;
  /** Daha eski commit'ler var mı? */
  hasMore: boolean;
}

// ---- v3: GitHub katmanı ----

export type CiState = 'success' | 'failure' | 'pending' | 'none';

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string;
  headRef: string;
  baseRef: string;
  isDraft: boolean;
  /** ms */
  updatedAt: number;
  /** PR'ın değiştirdiği dosyalar (repo köküne göre, "/" ayraçlı). */
  files: string[];
  /** PR'ın son commit'inin check/status özeti. */
  ci: CiState;
}

export interface BranchCi {
  /** Remote'taki branch adı ('main', 'feature/x'). */
  branch: string;
  ci: CiState;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  /** ms */
  resetAt: number;
}

export type GitHubStatus =
  /** Ayar kapalı ya da kullanıcı henüz bağlanmadı ("Şimdi değil" dahil). */
  | { state: 'off'; dismissed: boolean }
  /** origin yok. */
  | { state: 'noRemote' }
  /** origin GitHub değil (GitLab vb.); katman sessizce kapalı. */
  | { state: 'notGitHub'; remoteUrl: string }
  | { state: 'connecting' }
  | {
      state: 'connected';
      /** 'owner/repo' */
      repo: string;
      fetchedAt: number;
      /** Geçerli yenileme aralığı, dakika (limit azalınca büyür). */
      intervalMin: number;
      /** Ayardaki aralık, dakika. */
      baseIntervalMin: number;
      rateLimit?: RateLimitInfo;
    }
  /** Veri var ama güncel değil: oturum düştü, ağ yok ya da limit bitti. */
  | { state: 'stale'; repo: string; fetchedAt: number; reason: 'sessionExpired' | 'offline' | 'rateLimited'; rateLimit?: RateLimitInfo }
  | { state: 'error'; message: string };

export interface GitHubData {
  status: GitHubStatus;
  pullRequests: PullRequest[];
  branchCi: BranchCi[];
}

// ---- v4: zaman makinesi ----

export interface TimelineEvent {
  /** ms */
  date: number;
  hash: string;
  message: string;
  author: string;
  /** TimelineData.paths indeksleri (yeniden adlandırma takipli, bugünkü adlar). */
  files: number[];
}

export interface TimelineMark {
  /** ms */
  date: number;
  label: string;
  kind: 'first' | 'tag' | 'merge';
}

export interface TimelineData {
  /** İlk ve son commit tarihi, ms. */
  start: number;
  end: number;
  /** Haritadaki dosyalar (ignore uygulanmış, bugünkü adlar). */
  paths: string[];
  /** paths ile aynı sıra: dosyanın geçmişteki ilk commit'inin tarihi (ms). */
  firstSeen: number[];
  /** En eskiden en yeniye. */
  events: TimelineEvent[];
  /** Dönüm noktaları (ilk commit, etiketler, gerekirse merge'ler), en eskiden yeniye. */
  marks: TimelineMark[];
}

// ---- v4: katkı paneli ----

export interface AuthorStat {
  /** Kimlik anahtarı: .mailmap uygulanmış e-posta (küçük harf). */
  key: string;
  name: string;
  email: string;
  commits: number;
  added: number;
  deleted: number;
  /** En çok satır değiştirdiği modül. */
  topModule?: string;
}

export interface ModuleOwnership {
  /** 'src/git' gibi klasör yolu; kök dosyalar için ''. */
  module: string;
  /** Aralıkta değişen satır (eklenen + silinen) toplamı. */
  total: number;
  /** Yazar payları, çoktan aza. */
  shares: { author: string; lines: number }[];
}

export interface FileExpert {
  path: string;
  /** AuthorStat.key */
  author: string;
  /** 0..1, bu yazarın dosyadaki değişen satır payı (aralıktan bağımsız, tüm geçmiş). */
  share: number;
}

export interface ContribData {
  range: TimeRange;
  /** Aralığın başı ve sonu, ms. */
  since: number;
  until: number;
  authors: AuthorStat[];
  modules: ModuleOwnership[];
  /** Haftalık ritim: her haftanın pazartesi 00:00'ı (yerel), eskiden yeniye. */
  weeks: number[];
  /** Yazar anahtarı → [hafta][gün (0=Pzt..6=Paz)] commit sayısı. '' anahtarı = herkes. */
  rhythm: Record<string, number[][]>;
  /** En sıcak dosyalar için "en iyi kim bilir". */
  experts: FileExpert[];
}

// ---- v5: değişiklikler ve git işlemleri ----

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked';

export interface LineStat {
  added: number;
  deleted: number;
}

export interface WorkingFile {
  /** Repo köküne göre, "/" ayraçlı (yeniden adlandırmada yeni ad). */
  path: string;
  oldPath?: string;
  /** Index'teki (commit'e girecek) değişiklik; yoksa undefined. */
  staged?: ChangeKind;
  /** Çalışma ağacındaki (henüz eklenmemiş) değişiklik; untracked dosyada 'untracked'. */
  unstaged?: ChangeKind;
  /** Birleştirme çakışması var mı? */
  conflicted: boolean;
  /** 0.3.0: çakışmanın türü (porcelain v2 XY); yalnızca conflicted iken. */
  conflict?: ConflictKind;
  /** Satır istatistikleri (binary'de yok). */
  stagedStat?: LineStat;
  unstagedStat?: LineStat;
}

export type RepoOperation = 'merge' | 'rebase' | 'cherryPick' | 'revert';

/** Çakışma türü: iki taraf da değiştirdi / ekledi / sildi ya da bir taraf sildi / ekledi. */
export type ConflictKind = 'bothModified' | 'bothAdded' | 'bothDeleted' | 'addedByUs' | 'addedByThem' | 'deletedByUs' | 'deletedByThem';

export interface WorkingTreeStatus {
  /** Checkout edilmiş branch; detached HEAD'de yok. */
  branch?: string;
  /** HEAD commit'i; boş repoda yok. */
  head?: string;
  /** 'origin/main' */
  upstream?: string;
  ahead: number;
  behind: number;
  files: WorkingFile[];
  /** Devam eden merge/rebase/cherry-pick/revert. */
  operation?: RepoOperation;
  stashCount: number;
  lastCommit?: {
    hash: string;
    shortHash: string;
    message: string;
    /** Upstream'de var mı (geri alma/amend uyarısı için). */
    pushed: boolean;
  };
}

export interface StashEntry {
  /** stash@{index} */
  index: number;
  message: string;
  /** ms */
  date: number;
  /** Stash'in alındığı branch. */
  branch?: string;
}

export type PullStrategy = 'ff' | 'merge' | 'rebase';

/** Webview'dan istenen bir git işlemi. Riskli olanları eklenti modal diyalogla onaylatır. */
export type GitOpRequest =
  | { kind: 'stage'; paths: string[] }
  | { kind: 'stageAll' }
  | { kind: 'unstage'; paths: string[] }
  | { kind: 'unstageAll' }
  /** Çalışma ağacındaki değişikliği geri al (untracked dosyayı sil). Onaylı. */
  | { kind: 'discard'; paths: string[] }
  | { kind: 'commit'; message: string; amend: boolean; push: boolean }
  /** git reset --soft HEAD~1 (değişiklikler index'te kalır). Push edilmişse onaylı. */
  | { kind: 'undoLastCommit' }
  | { kind: 'fetch' }
  /** strategy yoksa önce fast-forward denenir, olmazsa kullanıcıya sorulur. */
  | { kind: 'pull'; strategy?: PullStrategy }
  /** force: --force-with-lease (onaylı). Upstream yoksa -u origin <branch>. */
  | { kind: 'push'; force?: boolean }
  /** Commit edilmemiş değişiklik varsa "sakla ve geç" sorulur. */
  | { kind: 'checkout'; branch: string }
  | { kind: 'createBranch'; name: string; from?: string; checkout: boolean }
  | { kind: 'mergeBranch'; branch: string }
  | { kind: 'renameBranch'; from: string; to: string }
  /** Onaylı; birleşmemişse ikinci onayla -D. */
  | { kind: 'deleteBranch'; name: string }
  | { kind: 'stashSave'; message?: string; includeUntracked: boolean }
  | { kind: 'stashApply'; index: number; pop: boolean }
  /** Onaylı. */
  | { kind: 'stashDrop'; index: number }
  | { kind: 'markResolved'; paths: string[] }
  /** 0.3.0: çakışan dosyada bir tarafın sürümünü al ve çözüldü işaretle (onaylı). O tarafta dosya yoksa silinir. */
  | { kind: 'resolveSide'; path: string; side: 'ours' | 'theirs' }
  | { kind: 'continueOperation' }
  /** Onaylı. */
  | { kind: 'abortOperation' };

export type GitOpKind = GitOpRequest['kind'];

export interface OpResult {
  /** İsteği yapan webview'ın verdiği kimlik. */
  id: string;
  kind: GitOpKind | GitHubOpKind;
  ok: boolean;
  /** Kullanıcı onay diyaloğunda vazgeçti. */
  cancelled?: boolean;
  /** Çalıştırılan komutlar ("git push -u origin x"), satır satır. */
  commands: string[];
  /** Etkin dilde (tr/en) kısa sonuç ya da hata açıklaması (ne yapılacağıyla birlikte). */
  message: string;
  /** Ham git çıktısı (hata ayrıntısı, hook çıktısı). */
  detail?: string;
}

// ---- v5 (2. tur): GitHub PR işlemleri ----

export type ReviewDecision = 'approved' | 'changesRequested' | 'reviewRequired' | 'none';
export type Mergeable = 'mergeable' | 'conflicting' | 'unknown';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PrCheck {
  name: string;
  state: CiState;
  /** Ayrıntı sayfası (https://github.com/…). */
  url?: string;
}

export interface PullRequestDetail extends PullRequest {
  body: string;
  mergeable: Mergeable;
  reviewDecision: ReviewDecision;
  /** Görüntüleyen kullanıcıdan review istenmiş mi? */
  reviewRequested: boolean;
  /** Fork'tan açılmış PR. */
  isCrossRepository: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: PrCheck[];
}

export interface PrPanelData {
  /** Bağlı GitHub kullanıcısının login'i. */
  viewer: string;
  defaultBranch: string;
  /** Repoda izin verilen birleştirme yöntemleri. */
  mergeMethods: MergeMethod[];
  /** Checkout edilmiş branch'in açık PR'ı. */
  currentBranchPr?: PullRequestDetail;
  /** Kullanıcının açtığı açık PR'lar. */
  mine: PullRequestDetail[];
  /** Kullanıcıdan review istenen açık PR'lar. */
  reviewRequested: PullRequestDetail[];
  /** ms */
  fetchedAt: number;
}

export interface PrDraft {
  head: string;
  base: string;
  /** Commit'lerden önerilen başlık ve açıklama. */
  title: string;
  body: string;
  /** base..head arasındaki commit sayısı. */
  commits: number;
  /** Branch henüz gönderilmemiş ya da gönderilmemiş commit'i var → PR'dan önce push gerekir. */
  needsPush: boolean;
}

export type GitHubOpRequest =
  /** Gerekirse önce push (onaylı). */
  | { kind: 'createPr'; title: string; body: string; base: string; draft: boolean }
  /** Onaylı. deleteBranch: uzak branch'i sil. */
  | { kind: 'mergePr'; number: number; method: MergeMethod; deleteBranch: boolean }
  /** PR'ın branch'ini yerelde checkout et (fork'ta pr/<n>). */
  | { kind: 'checkoutPr'; number: number };

export type GitHubOpKind = GitHubOpRequest['kind'];

// ---- 0.3.0: çoklu klasörlü workspace ----

/** Haritanın renk ölçeği: değişim sıklığı (seçili aralıkta commit sayısı) ya da tazelik (son değişiklikten bu yana geçen süre). */
export type ColorMode = 'churn' | 'recency';

/** Workspace klasörlerinde bulunan bir git reposu. */
export interface RepoInfo {
  /** Repo kökü, mutlak yol. */
  root: string;
  /** Kök klasörün adı (gösterim). */
  name: string;
}
