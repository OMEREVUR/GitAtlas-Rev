// Ortak biçimleyiciler (Türkçe). Saf fonksiyonlar; DOM kullanmaz.

const nf = new Intl.NumberFormat('tr-TR');

/** 12345 → "12.345" */
export function formatNumber(n: number): string {
  return nf.format(n);
}

/** ms farkını "az önce", "5 dk önce", "3 saat önce", "2 gün önce", "4 hafta önce", "3 ay önce", "2 yıl önce" yapar. */
export function formatRelative(ms: number, now: number): string {
  if (ms <= 0) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'az önce';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} saat önce`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} gün önce`;
  if (d < 60) return `${Math.floor(d / 7)} hafta önce`;
  if (d < 365) return `${Math.floor(d / 30)} ay önce`;
  return `${Math.floor(d / 365)} yıl önce`;
}

/** Mutlak tarih: "16 Eki 2026 23:38" */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** TimeRange etiketi: kısa ("7g", "30g", "tümü") ve uzun ("7 gün", "30 gün", "Tümü"). */
export const RANGE_SHORT = { '7d': '7g', '30d': '30g', all: 'tümü' } as const;
export const RANGE_LONG = { '7d': '7 gün', '30d': '30 gün', all: 'Tümü' } as const;

/** "src/git/logParser.ts" → "logParser.ts" */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}
