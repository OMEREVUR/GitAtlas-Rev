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
