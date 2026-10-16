// SÖZLEŞME — webview ↔ eklenti mesajları. Değişiklik yalnızca bilinçli bir kararla yapılır.
import type { CommitSummary, ContribData, FileStat, GitHubData, GitOpKind, GitOpRequest, GraphData, OpResult, StashEntry, TimeRange, TimelineData, WorkingTreeStatus } from './types';

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
      /** rewiewrev.graph.initialCommits ayarı (graph sayfa boyutu). */
      graphPageSize?: number;
    }
  | { type: 'error'; code: ErrorCode; message: string }
  // v2
  | { type: 'graphLoading' }
  | { type: 'graph'; graph: GraphData }
  | { type: 'graphError'; message: string }
  /** Branch'ler panelinde seçim (undefined = seçim kalktı). */
  | { type: 'selectBranch'; name: string | undefined }
  // v3
  | { type: 'github'; data: GitHubData }
  // v4
  | { type: 'timeline'; timeline: TimelineData }
  | { type: 'contrib'; contrib: ContribData }
  // v5
  | { type: 'status'; status: WorkingTreeStatus }
  | { type: 'stashes'; stashes: StashEntry[] }
  | { type: 'opStarted'; id: string; kind: GitOpKind; commands: string[] }
  | { type: 'opResult'; result: OpResult };

export type WebviewToExtension =
  | { type: 'ready' }
  | { type: 'setRange'; range: TimeRange }
  | { type: 'openFile'; path: string }
  | { type: 'openDiff'; path: string; hash: string }
  | { type: 'refresh' }
  | { type: 'command'; action: StateAction }
  // v2
  /** Graph'ı (yeniden) yükle. branch undefined = tüm branch'ler. limit: en fazla commit (500, 1000, …). */
  | { type: 'loadGraph'; branch?: string; limit: number }
  // v3
  | { type: 'githubConnect' }
  /** "Şimdi değil": bu çalışma alanında bağlanma çağrısını gizle. */
  | { type: 'githubDismiss' }
  | { type: 'githubRefresh' }
  /** Yalnızca https://github.com/… adresleri açılır. */
  | { type: 'openUrl'; url: string }
  // v4
  | { type: 'loadTimeline' }
  | { type: 'loadContrib'; range: TimeRange }
  // v5
  /** Çalışma ağacı durumunu (ve stash listesini) iste; ayrıca değişiklikleri izlemeye başla. */
  | { type: 'loadStatus' }
  /** id: webview'ın sonucu eşleştirmek için verdiği benzersiz kimlik. */
  | { type: 'gitOp'; id: string; op: GitOpRequest }
  /** Değişikliğin diff'i: staged → HEAD ↔ index, değilse index ↔ çalışma ağacı. */
  | { type: 'openChange'; path: string; staged: boolean }
  /** "RewiewRev Git" çıktı kanalını göster. */
  | { type: 'showOutput' };
