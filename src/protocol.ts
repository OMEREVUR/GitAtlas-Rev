// SÖZLEŞME — webview ↔ eklenti mesajları. Değişiklik yalnızca bilinçli bir kararla yapılır.
import type { CommitSummary, FileStat, GraphData, TimeRange } from './types';

/** Panelde gösterilen hata durumları (tasarım: States.dc.html). */
export type ErrorCode = 'noWorkspace' | 'noRepo' | 'noCommits' | 'noGit' | 'unknown';

/** Durum ekranlarındaki butonların eklentide karşılığı olan eylemler. */
export type StateAction = 'openFolder' | 'initRepo' | 'openScm' | 'openGitPathSetting' | 'downloadGit';

export type ExtensionToWebview =
  /** progress 0..1 */
  | { type: 'loading'; progress: number }
  | {
      type: 'model';
      range: TimeRange;
      /** Repo klasörünün adı (yol çubuğunun kökü). */
      repoName: string;
      /** Hariç tutmalar uygulanmış dosyalar. */
      files: FileStat[];
      /** Aralıktan bağımsız, en yeniden en eskiye, en fazla 1000 commit. */
      commits: CommitSummary[];
    }
  | { type: 'error'; code: ErrorCode; message: string }
  // v2
  | { type: 'graphLoading' }
  | { type: 'graph'; graph: GraphData }
  | { type: 'graphError'; message: string }
  /** Branch'ler panelinde seçim (undefined = seçim kalktı). */
  | { type: 'selectBranch'; name: string | undefined };

export type WebviewToExtension =
  | { type: 'ready' }
  | { type: 'setRange'; range: TimeRange }
  | { type: 'openFile'; path: string }
  | { type: 'openDiff'; path: string; hash: string }
  | { type: 'refresh' }
  | { type: 'command'; action: StateAction }
  // v2
  /** Graph'ı (yeniden) yükle. branch undefined = tüm branch'ler. limit: en fazla commit (500, 1000, …). */
  | { type: 'loadGraph'; branch?: string; limit: number };
