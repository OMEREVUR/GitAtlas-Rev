// Ortak ısı seviyesi hesabı: treemap, dosya kartı ve lejant aynı ölçeği kullanır.
import type { ColorMode, FileStat } from '../types';
import { text } from '../i18n/map';

/** 0 = aralıkta hiç değişmedi, 1..5 = churn yüzdelik dilimi (5 en sıcak). */
export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Seviyenin etkin dildeki adı: "Değişmedi" … "Çok sık". */
export function heatLabel(level: number): string {
  return text().heatLabel(level);
}

/** Tazelik seviyesinin etkin dildeki adı: "Commit yok" … "Son 24 saat". */
export function recencyLabel(level: number): string {
  return text().recencyLabel(level);
}

/** Moda göre seviye adı. */
export function levelLabel(mode: ColorMode, level: number): string {
  return mode === 'recency' ? recencyLabel(level) : heatLabel(level);
}

/** Seviyenin CSS değişkeni: var(--rr-c0) … var(--rr-c5). */
export function heatVar(level: HeatLevel): string {
  return `var(--rr-c${level})`;
}

/**
 * changes > 0 olan dosyaları churn'e göre sıralar ve yüzdelik dilime göre 1..5 seviye verir.
 * Aynı changes değerine sahip dosyalar aynı seviyeyi alır: grubun en alt sırası (0.3.0). Böylece genç bir
 * repoda çoğunluğu oluşturan "1 commit'lik" dosyalar soğuk kalır; eskiden grubun en üst sırasını alıp
 * hep birlikte sıcak görünüyorlardı.
 */
export function heatLevels(files: readonly FileStat[]): Map<string, HeatLevel> {
  const result = new Map<string, HeatLevel>();
  const values = files.filter((f) => f.changes > 0).map((f) => f.changes).sort((a, b) => a - b);
  const n = values.length;
  const firstRank = new Map<number, number>();
  values.forEach((v, i) => {
    if (!firstRank.has(v)) firstRank.set(v, i + 1);
  });
  for (const f of files) {
    if (f.changes <= 0 || n === 0) {
      result.set(f.path, 0);
      continue;
    }
    const rank = firstRank.get(f.changes) ?? n;
    // En az değişen grup her zaman 1: az dosyada ceil(1/n·5) 1'den büyük çıkardı.
    if (rank === 1) {
      result.set(f.path, 1);
      continue;
    }
    const q = rank / n;
    result.set(f.path, Math.min(5, Math.max(1, Math.ceil(q * 5))) as HeatLevel);
  }
  return result;
}

const DAY = 864e5;
/** Tazelik dilimlerinin üst sınırları (gün): seviye 5 = son 1 gün, 4 = 3 gün, 3 = 1 hafta, 2 = 1 ay. */
const RECENCY_DAYS: readonly [number, HeatLevel][] = [[1, 5], [3, 4], [7, 3], [30, 2]];

/**
 * 0.3.0 tazelik ölçeği: son değişiklikten (tüm geçmiş) bu yana geçen süreye göre sabit dilimler.
 * Seçili aralıktan bağımsızdır; hiç commit'i olmayan dosya (lastModified 0) 0 alır.
 */
export function recencyLevels(files: readonly FileStat[], now: number): Map<string, HeatLevel> {
  const result = new Map<string, HeatLevel>();
  for (const f of files) {
    if (f.lastModified <= 0) {
      result.set(f.path, 0);
      continue;
    }
    const age = Math.max(0, now - f.lastModified);
    const hit = RECENCY_DAYS.find(([days]) => age <= days * DAY);
    result.set(f.path, hit ? hit[1] : 1);
  }
  return result;
}

/** Haritanın renk modu için seviyeler. */
export function levelsFor(mode: ColorMode, files: readonly FileStat[], now: number): Map<string, HeatLevel> {
  return mode === 'recency' ? recencyLevels(files, now) : heatLevels(files);
}
