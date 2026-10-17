// Ortak biçimleyiciler (etkin dile göre Türkçe/İngilizce). Saf fonksiyonlar; DOM kullanmaz.
import type { TimeRange } from '../types';
import { defineText, getLang, locale } from '../i18n';

const formats = new Map<string, Intl.NumberFormat>();

/** 12345 → "12.345" (tr) / "12,345" (en) */
export function formatNumber(n: number): string {
  const loc = locale();
  let nf = formats.get(loc);
  if (!nf) {
    nf = new Intl.NumberFormat(loc);
    formats.set(loc, nf);
  }
  return nf.format(n);
}

const T = defineText({
  tr: {
    justNow: 'az önce',
    minutes: (n: number) => `${n} dk önce`,
    hours: (n: number) => `${n} saat önce`,
    days: (n: number) => `${n} gün önce`,
    weeks: (n: number) => `${n} hafta önce`,
    months: (n: number) => `${n} ay önce`,
    years: (n: number) => `${n} yıl önce`,
  },
  en: {
    justNow: 'just now',
    minutes: (n: number) => `${n} min ago`,
    hours: (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'} ago`,
    days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'} ago`,
    weeks: (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'} ago`,
    months: (n: number) => `${n} ${n === 1 ? 'month' : 'months'} ago`,
    years: (n: number) => `${n} ${n === 1 ? 'year' : 'years'} ago`,
  },
});

/** ms farkını "az önce", "5 dk önce", "3 saat önce", "2 gün önce", "4 hafta önce", "3 ay önce", "2 yıl önce" yapar. */
export function formatRelative(ms: number, now: number): string {
  if (ms <= 0) return '—';
  const t = T();
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return t.justNow;
  const m = Math.floor(s / 60);
  if (m < 60) return t.minutes(m);
  const h = Math.floor(m / 60);
  if (h < 24) return t.hours(h);
  const d = Math.floor(h / 24);
  if (d < 14) return t.days(d);
  if (d < 60) return t.weeks(Math.floor(d / 7));
  if (d < 365) return t.months(Math.floor(d / 30));
  return t.years(Math.floor(d / 365));
}

/** Mutlak tarih: "16 Eki 2026 23:38" (tr) / "Oct 16, 2026, 11:38 PM" (en) */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const RANGE = {
  tr: { short: { '7d': '7g', '30d': '30g', all: 'tümü' }, long: { '7d': '7 gün', '30d': '30 gün', all: 'Tümü' } },
  en: { short: { '7d': '7d', '30d': '30d', all: 'all' }, long: { '7d': '7 days', '30d': '30 days', all: 'All' } },
} as const;

/** TimeRange etiketi, kısa: "7g", "30g", "tümü" (en: "7d", "30d", "all"). */
export function rangeShort(r: TimeRange): string {
  return RANGE[getLang()].short[r];
}

/** TimeRange etiketi, uzun: "7 gün", "30 gün", "Tümü" (en: "7 days", "30 days", "All"). */
export function rangeLong(r: TimeRange): string {
  return RANGE[getLang()].long[r];
}

/** "src/git/logParser.ts" → "logParser.ts" */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}
