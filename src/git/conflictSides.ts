// SAF: çakışmada "--ours" / "--theirs" taraflarının anlamı ve varlığı. Eklenti (işlem + onay) ve webview (düğme etiketleri) kullanır.
import type { ConflictKind, RepoOperation } from '../types';

export type ConflictSide = 'ours' | 'theirs';

/**
 * Tarafın kullanıcıya göre anlamı. Rebase'de git tarafları ters çevirir: --ours üzerine rebase edilen
 * branch, --theirs yeniden uygulanan kendi commit'indir.
 */
export type SideRole = 'current' | 'incoming' | 'onto' | 'yours' | 'picked' | 'revert';

export function sideRole(operation: RepoOperation | undefined, side: ConflictSide): SideRole {
  switch (operation) {
    case 'rebase':
      return side === 'ours' ? 'onto' : 'yours';
    case 'cherryPick':
      return side === 'ours' ? 'current' : 'picked';
    case 'revert':
      return side === 'ours' ? 'current' : 'revert';
    default:
      // merge ve işlem dışı çakışmalar (ör. stash pop): HEAD ↔ gelen değişiklik
      return side === 'ours' ? 'current' : 'incoming';
  }
}

/** Porcelain v2 'u' satırındaki XY → çakışma türü. */
export function conflictKindFromXY(xy: string): ConflictKind {
  switch (xy) {
    case 'DD':
      return 'bothDeleted';
    case 'AU':
      return 'addedByUs';
    case 'UD':
      return 'deletedByThem';
    case 'UA':
      return 'addedByThem';
    case 'DU':
      return 'deletedByUs';
    case 'AA':
      return 'bothAdded';
    default:
      return 'bothModified';
  }
}

/** O tarafta dosyanın bir sürümü var mı? Yoksa o tarafı seçmek dosyayı silmek demektir. */
export function sideExists(kind: ConflictKind | undefined, side: ConflictSide): boolean {
  if (kind === 'bothDeleted') return false;
  if (side === 'ours') return kind !== 'deletedByUs' && kind !== 'addedByThem';
  return kind !== 'deletedByThem' && kind !== 'addedByUs';
}
