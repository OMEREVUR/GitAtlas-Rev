// 0.3.0: çoklu klasörlü workspace — repoları bulur, seçimi hatırlar, repo seçiciyi ve durum çubuğu öğesini yönetir.
import * as vscode from 'vscode';
import { runGit } from '../git/gitRunner';
import { panelText } from '../i18n/panel';
import { chooseRepo, repoForPath, uniqueRepos } from '../model/repoSelect';
import type { RepoInfo } from '../types';

const SELECTED_KEY = 'gitatlas-revrev.repo';
const FOLLOW_KEY = 'gitatlas-revrev.repo.followActiveFile';
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/** workspaceState'in kullanılan kısmı (testte sahtesi verilir). */
export interface RepoStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface RepoState {
  repos: RepoInfo[];
  current: string | undefined;
  follow: boolean;
}

export class RepoManager implements vscode.Disposable {
  private repos: RepoInfo[] = [];
  private current: string | undefined;
  private follow: boolean;
  /** Repo listesi yeniden bulunmalı mı (ilk açılış, klasör değişimi, elle yenileme)? */
  private stale = true;
  private discovering: Promise<void> | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<RepoState>();
  /** Liste, seçim ya da takip ayarı değişti (webview'lara gönderilir). */
  readonly onDidChange: vscode.Event<RepoState> = this.changeEmitter.event;
  private readonly selectEmitter = new vscode.EventEmitter<string>();
  /** Kullanıcı (ya da takip) başka bir repoya geçti; panel yeniden yüklenir. */
  readonly onDidSelect: vscode.Event<string> = this.selectEmitter.event;

  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly state: RepoStore,
    /** Şu an repo değiştirilebilir mi (sürmekte olan git işlemi yoksa)? */
    private readonly canSwitch: () => boolean,
  ) {
    this.follow = state.get<boolean>(FOLLOW_KEY) === true;
    this.item = vscode.window.createStatusBarItem('gitatlas-revrev.repo', vscode.StatusBarAlignment.Left, 1);
    this.item.name = 'GitAtlas-Rev repo';
    this.item.command = 'gitatlas-revrev.selectRepo';
    this.disposables.push(
      this.changeEmitter,
      this.selectEmitter,
      this.item,
      vscode.window.onDidChangeActiveTextEditor((e) => this.onActiveEditor(e)),
    );
  }

  get snapshot(): RepoState {
    return { repos: [...this.repos], current: this.current, follow: this.follow };
  }

  get currentRoot(): string | undefined {
    return this.current;
  }

  /** Bir sonraki ensure'da repolar yeniden bulunur. */
  markStale(): void {
    this.stale = true;
  }

  /** Gerekirse repoları bulur; seçili repo hâlâ yoksa ilk repoya geçer. */
  ensure(): Promise<void> {
    if (!this.stale) return Promise.resolve();
    this.discovering ??= this.discover().finally(() => {
      this.discovering = undefined;
    });
    return this.discovering;
  }

  private async discover(): Promise<void> {
    this.stale = false;
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
    const roots = await Promise.all(
      folders.map(async (f) => {
        try {
          return vscode.Uri.file((await runGit(['rev-parse', '--show-toplevel'], f.uri.fsPath)).trim()).fsPath;
        } catch {
          return undefined; // repo değil ya da git yok: panel hatayı ilk klasör üzerinden gösterir
        }
      }),
    );
    const repos = uniqueRepos(roots.filter((r): r is string => r !== undefined), CASE_INSENSITIVE);
    const current = chooseRepo(repos, this.current ?? this.state.get<string>(SELECTED_KEY), CASE_INSENSITIVE);
    const changed =
      current !== this.current ||
      repos.length !== this.repos.length ||
      repos.some((r, i) => r.root !== this.repos[i]?.root);
    this.repos = repos;
    this.current = current;
    this.renderItem();
    if (changed) this.changeEmitter.fire(this.snapshot);
  }

  /** Başka bir repoya geçer (seçim hatırlanır). Aynı repo ya da işlem sürüyorsa bir şey yapmaz. */
  async select(root: string): Promise<boolean> {
    if (root === this.current) return true;
    if (!this.repos.some((r) => r.root === root)) return false;
    if (!this.canSwitch()) {
      void vscode.window.showWarningMessage(panelText().repoBusy);
      return false;
    }
    this.current = root;
    await this.state.update(SELECTED_KEY, root);
    this.renderItem();
    this.changeEmitter.fire(this.snapshot);
    this.selectEmitter.fire(root);
    return true;
  }

  async setFollow(follow: boolean): Promise<void> {
    if (follow === this.follow) return;
    this.follow = follow;
    await this.state.update(FOLLOW_KEY, follow);
    this.changeEmitter.fire(this.snapshot);
    if (follow) this.onActiveEditor(vscode.window.activeTextEditor);
  }

  /** Repo seçici: repolar + "açık dosyanın reposunu takip et". */
  async showPicker(): Promise<void> {
    await this.ensure();
    const t = panelText();
    if (this.repos.length === 0) {
      void vscode.window.showInformationMessage(t.repoNone);
      return;
    }
    type Item = vscode.QuickPickItem & { root?: string; toggle?: boolean };
    const items: Item[] = this.repos.map((r) => ({
      label: `${r.root === this.current ? '$(check)' : '$(repo)'} ${r.name}`,
      description: r.root === this.current ? t.repoCurrent : undefined,
      detail: r.root,
      root: r.root,
    }));
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      {
        label: `${this.follow ? '$(pass-filled)' : '$(circle-large-outline)'} ${t.repoFollow}`,
        description: this.follow ? t.repoFollowOn : t.repoFollowOff,
        toggle: true,
      },
    );
    const picked = await vscode.window.showQuickPick(items, { title: t.repoPickTitle, placeHolder: t.repoPickPlaceholder });
    if (!picked) return;
    if (picked.toggle) await this.setFollow(!this.follow);
    else if (picked.root) await this.select(picked.root);
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!this.follow || !editor || editor.document.uri.scheme !== 'file' || this.repos.length < 2) return;
    const root = repoForPath(this.repos, editor.document.uri.fsPath, CASE_INSENSITIVE);
    // Takip sessiz çalışır: işlem sürüyorsa uyarı göstermeden atla.
    if (root && root !== this.current && this.canSwitch()) void this.select(root);
  }

  /** Durum çubuğu öğesi yalnızca 2+ repo varken görünür. */
  private renderItem(): void {
    const cur = this.repos.find((r) => r.root === this.current);
    if (this.repos.length < 2 || !cur) {
      this.item.hide();
      return;
    }
    const t = panelText();
    this.item.text = t.repoStatus(cur.name);
    this.item.tooltip = t.repoStatusTooltip(cur.name, this.repos.length);
    this.item.show();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
