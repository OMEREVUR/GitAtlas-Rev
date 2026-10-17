// Ortak ısı seviyesi hesabı: treemap, dosya kartı ve lejant aynı ölçeği kullanır.
import type { FileStat } from '../types';
import { text } from '../i18n/map';

/** 0 = aralıkta hiç değişmedi, 1..5 = churn yüzdelik dilimi (5 en sıcak). */
export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Seviyenin etkin dildeki adı: "Değişmedi" … "Çok sık". */
export function heatLabel(level: number): string {
  return text().heatLabel(level);
}

/** Seviyenin CSS değişkeni: var(--rr-c0) … var(--rr-c5). */
export function heatVar(level: HeatLevel): string {
  return `var(--rr-c${level})`;
}

/**
 * changes > 0 olan dosyaları churn'e göre sıralar ve yüzdelik dilime göre 1..5 seviye verir.
 * Aynı changes değerine sahip dosyalar aynı seviyeyi alır.
 */
export function heatLevels(files: readonly FileStat[]): Map<string, HeatLevel> {
  const result = new Map<string, HeatLevel>();
  const values = files.filter((f) => f.changes > 0).map((f) => f.changes).sort((a, b) => a - b);
  const n = values.length;
  const atMost = new Map<number, number>();
  values.forEach((v, i) => atMost.set(v, i + 1));
  for (const f of files) {
    if (f.changes <= 0 || n === 0) {
      result.set(f.path, 0);
      continue;
    }
    const q = (atMost.get(f.changes) ?? n) / n;
    result.set(f.path, Math.min(5, Math.max(1, Math.ceil(q * 5))) as HeatLevel);
  }
  return result;
}
