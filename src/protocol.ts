// SÖZLEŞME — webview ↔ eklenti mesajları. Değişiklik yalnızca bilinçli bir kararla yapılır.
import type { CommitSummary, FileStat, TimeRange } from './types';

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
  | { type: 'error'; code: ErrorCode; message: string };

export type WebviewToExtension =
  | { type: 'ready' }
  | { type: 'setRange'; range: TimeRange }
  | { type: 'openFile'; path: string }
  | { type: 'openDiff'; path: string; hash: string }
  | { type: 'refresh' }
  | { type: 'command'; action: StateAction };
