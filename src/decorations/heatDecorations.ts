import * as vscode from 'vscode';
import { type BadgeMode, getBadgeMode } from '../config';
import type { FileStat, PullRequest } from '../types';
import { heatLevels } from '../webview/heat';

/** 2 = en sıcak %10 ("●●"), 1 = sonraki %20 ("●"). */
export type HeatTier = 1 | 2;

/**
 * Seçili aralıkta değişmiş (changes > 0) dosyaları sıralar ve rozet dilimini verir.
 * En sıcak %10 (en az 1 dosya) → 2, sonraki %20 → 1. Eşitlikte yol sırası belirleyicidir.
 */
export function computeHeatTiers(files: readonly Pick<FileStat, 'path' | 'changes'>[]): Map<string, HeatTier> {
  const changed = files
    .filter((f) => f.changes > 0)
    .sort((a, b) => b.changes - a.changes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const n = changed.length;
  const tiers = new Map<string, HeatTier>();
  if (n === 0) return tiers;
  const hotEnd = Math.max(1, Math.round(n * 0.1));
  const warmEnd = Math.min(n, Math.max(hotEnd, Math.round(n * 0.3)));
  for (let i = 0; i < warmEnd; i++) tiers.set(changed[i].path, i < hotEnd ? 2 : 1);
  return tiers;
}

/** Rozet metni ve Türkçe tooltip. VS Code rozeti en fazla 2 karakter kabul eder. */
export function heatBadge(tier: HeatTier, changes: number): { badge: string; tooltip: string } {
  return tier === 2
    ? { badge: '●●', tooltip: `GitAtlas-RevRev: çok sık değişiyor · ${changes} commit` }
    : { badge: '●', tooltip: `GitAtlas-RevRev: sık değişiyor · ${changes} commit` };
}

/** Bu kadar ve üstü açık PR aynı dosyaya dokunursa PR rozeti ısının önüne geçer. */
export const PR_BADGE_MIN = 2;

export interface BadgeSpec {
  kind: 'heat' | 'pr';
  /** En fazla 2 karakter. */
  badge: string;
  tooltip: string;
}

/** Dosya yolu → kendisine dokunan açık PR sayısı. */
export function countPrsByFile(prs: readonly Pick<PullRequest, 'files'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pr of prs) {
    for (const f of new Set(pr.files)) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return counts;
}

/** PR sayısı rozeti: 2..9, üstü "9+" (2 karakter). */
export function prBadgeText(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/**
 * Her dosyanın rozeti. 'off' → hiç; 'hot' → ●●/●; 'all' → değişen her dosyada 1..5 ısı seviyesi.
 * prCounts'ta 2+ PR olan dosyada PR sayısı ısının önüne geçer ('off' hariç).
 */
export function computeBadges(
  files: readonly FileStat[],
  mode: BadgeMode,
  prCounts?: ReadonlyMap<string, number>,
): Map<string, BadgeSpec> {
  const out = new Map<string, BadgeSpec>();
  if (mode === 'off') return out;

  if (mode === 'hot') {
    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const [p, tier] of computeHeatTiers(files)) {
      const stat = byPath.get(p);
      if (stat) out.set(p, { kind: 'heat', ...heatBadge(tier, stat.changes) });
    }
  } else {
    const levels = heatLevels(files);
    for (const f of files) {
      const level = levels.get(f.path) ?? 0;
      if (level > 0) {
        out.set(f.path, { kind: 'heat', badge: String(level), tooltip: `GitAtlas-RevRev: ısı ${level}/5 · ${f.changes} commit` });
      }
    }
  }

  if (prCounts) {
    for (const f of files) {
      const n = prCounts.get(f.path) ?? 0;
      if (n >= PR_BADGE_MIN) {
        out.set(f.path, {
          kind: 'pr',
          badge: prBadgeText(n),
          tooltip: `GitAtlas-RevRev: ${n} açık PR bu dosyaya dokunuyor (çakışma riski)`,
        });
      }
    }
  }
  return out;
}

/** Explorer URI'ları ile bizim ürettiğimiz URI'ların eşleşmesi için anahtar (Windows'ta büyük/küçük harf duyarsız). */
function uriKey(uri: vscode.Uri): string {
  return process.platform === 'win32' ? uri.fsPath.toLowerCase() : uri.fsPath;
}

export class HeatDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  private entries = new Map<string, { uri: vscode.Uri; decoration: vscode.FileDecoration }>();

  /** Rozetleri yeniden kurar. Mod `gitatlas-revrev.explorer.badges` ayarından okunur. */
  update(files: FileStat[], root: string, prCounts?: Map<string, number>): void {
    const old = this.entries;
    const next = new Map<string, { uri: vscode.Uri; decoration: vscode.FileDecoration }>();
    if (root) {
      const base = vscode.Uri.file(root);
      for (const [p, spec] of computeBadges(files, getBadgeMode(), prCounts)) {
        const uri = vscode.Uri.joinPath(base, ...p.split('/'));
        // Isı rozetine renk verilmez (Git'in M/U renklerini ezmesin); PR çakışması mor.
        const color = spec.kind === 'pr' ? new vscode.ThemeColor('charts.purple') : undefined;
        const decoration = new vscode.FileDecoration(spec.badge, spec.tooltip, color);
        decoration.propagate = false;
        next.set(uriKey(uri), { uri, decoration });
      }
    }
    this.entries = next;

    const changed: vscode.Uri[] = [];
    for (const [key, e] of old) if (!next.has(key)) changed.push(e.uri);
    for (const e of next.values()) changed.push(e.uri);
    if (changed.length > 0) this.emitter.fire(changed);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    return this.entries.get(uriKey(uri))?.decoration;
  }

  dispose(): void {
    this.entries.clear();
    this.emitter.dispose();
  }
}
