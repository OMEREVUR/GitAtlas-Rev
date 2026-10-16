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
