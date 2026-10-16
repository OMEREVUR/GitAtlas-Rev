import * as vscode from 'vscode';
import type { FileStat } from '../types';

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
    ? { badge: '●●', tooltip: `RewiewRev: çok sık değişiyor · ${changes} commit` }
    : { badge: '●', tooltip: `RewiewRev: sık değişiyor · ${changes} commit` };
}

/** Explorer URI'ları ile bizim ürettiğimiz URI'ların eşleşmesi için anahtar (Windows'ta büyük/küçük harf duyarsız). */
function uriKey(uri: vscode.Uri): string {
  return process.platform === 'win32' ? uri.fsPath.toLowerCase() : uri.fsPath;
}

export class HeatDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  private entries = new Map<string, { uri: vscode.Uri; decoration: vscode.FileDecoration }>();

  update(files: FileStat[], root: string): void {
    const old = this.entries;
    const next = new Map<string, { uri: vscode.Uri; decoration: vscode.FileDecoration }>();
    if (root) {
      const base = vscode.Uri.file(root);
      const byPath = new Map(files.map((f) => [f.path, f]));
      for (const [path, tier] of computeHeatTiers(files)) {
        const stat = byPath.get(path);
        if (!stat) continue;
        const { badge, tooltip } = heatBadge(tier, stat.changes);
        const uri = vscode.Uri.joinPath(base, ...path.split('/'));
        // Renk verilmez: Git'in M/U renklerini ezmesin; anlam tooltip'te.
        const decoration = new vscode.FileDecoration(badge, tooltip);
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
