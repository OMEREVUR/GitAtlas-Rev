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
