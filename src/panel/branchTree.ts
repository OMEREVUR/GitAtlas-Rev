import * as vscode from 'vscode';
import type { GitRef } from '../types';
import { formatDate, formatRelative } from '../webview/format';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bu kadar süredir dokunulmamış branch "bayat" sayılır. */
export const STALE_MS = 30 * DAY_MS;

export function isStale(ref: Pick<GitRef, 'date'>, now: number): boolean {
  return ref.date > 0 && now - ref.date > STALE_MS;
}

/** HEAD önce, sonra son dokunmaya göre yeniden eskiye (eşitlikte ada göre). */
export function sortBranches(refs: readonly GitRef[]): GitRef[] {
  return [...refs].sort(
    (a, b) => Number(b.isHead) - Number(a.isHead) || b.date - a.date || a.name.localeCompare(b.name),
  );
}

/** Tag'leri ve "origin/HEAD" gibi sembolik remote ref'leri ayıklayıp iki bölüme ayırır. */
export function groupBranches(refs: readonly GitRef[]): { local: GitRef[]; remote: GitRef[] } {
  return {
    local: sortBranches(refs.filter((r) => r.kind === 'local')),
    remote: sortBranches(refs.filter((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD'))),
  };
}

/** "↑2 ↓0"; değer olmayan taraf atlanır. */
export function aheadBehindText(ref: Pick<GitRef, 'ahead' | 'behind'>): string {
  const parts: string[] = [];
  if (ref.ahead !== undefined) parts.push(`↑${ref.ahead}`);
  if (ref.behind !== undefined) parts.push(`↓${ref.behind}`);
  return parts.join(' ');
}

/** Ağaç öğesinin açıklaması: "HEAD · bayat · 3 gün önce · ↑2 ↓0" (olmayan parçalar atlanır). */
export function branchDescription(ref: GitRef, now: number): string {
  const parts: string[] = [];
  if (ref.isHead) parts.push('HEAD');
  if (isStale(ref, now)) parts.push('bayat');
  if (ref.date > 0) parts.push(formatRelative(ref.date, now));
  const ab = aheadBehindText(ref);
  if (ab) parts.push(ab);
  return parts.join(' · ');
}

/** "Karşılaştırma: origin/main · 2 ileride, 0 geride"; karşılaştırma yoksa undefined. */
export function aheadBehindSentence(ref: GitRef): string | undefined {
  if (ref.ahead === undefined && ref.behind === undefined) return undefined;
  const base = ref.compareTo ?? ref.upstream;
  const parts: string[] = [];
  if (ref.ahead !== undefined) parts.push(`${ref.ahead} ileride`);
  if (ref.behind !== undefined) parts.push(`${ref.behind} geride`);
  return base ? `Karşılaştırma: ${base} · ${parts.join(', ')}` : parts.join(', ');
}

/** Tooltip satırları (düz metin; markdown'a kaçışlanarak eklenir). */
export function branchTooltipLines(ref: GitRef, now: number): string[] {
  const lines: string[] = [];
  if (ref.subject) lines.push(ref.subject);
  const who = [ref.author, ref.date > 0 ? `${formatDate(ref.date)} (${formatRelative(ref.date, now)})` : '']
    .filter(Boolean)
    .join(' · ');
  if (who) lines.push(who);
  if (ref.upstream) lines.push(`Takip ettiği: ${ref.upstream}`);
  const ab = aheadBehindSentence(ref);
  if (ab) lines.push(ab);
  if (isStale(ref, now)) lines.push('Bayat: 30 günden uzun süredir dokunulmamış');
  return lines;
}

type Section = 'local' | 'remote';

type BranchNode =
  | { kind: 'section'; section: Section; refs: GitRef[] }
  | { kind: 'ref'; section: Section; ref: GitRef };

const SECTION_LABEL: Record<Section, string> = { local: 'Lokal', remote: 'Remote' };

class BranchTreeProvider implements vscode.TreeDataProvider<BranchNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  sections: BranchNode[] = [];
  readonly byName = new Map<string, Extract<BranchNode, { kind: 'ref' }>>();
  private readonly parents = new Map<BranchNode, BranchNode>();
  private now = Date.now();

  setRefs(refs: readonly GitRef[]): void {
    this.now = Date.now();
    this.byName.clear();
    this.parents.clear();
    const { local, remote } = groupBranches(refs);
    this.sections = [];
    for (const [section, list] of [['local', local], ['remote', remote]] as const) {
      if (list.length === 0) continue;
      const parent: BranchNode = { kind: 'section', section, refs: list };
      this.sections.push(parent);
      for (const ref of list) {
        const node: Extract<BranchNode, { kind: 'ref' }> = { kind: 'ref', section, ref };
        this.byName.set(ref.name, node);
        this.parents.set(node, parent);
      }
    }
    this.emitter.fire();
  }

  getChildren(node?: BranchNode): BranchNode[] {
    if (!node) return this.sections;
    if (node.kind === 'section') return node.refs.map((r) => this.byName.get(r.name)).filter((n) => n !== undefined);
    return [];
  }

  getParent(node: BranchNode): BranchNode | undefined {
    return this.parents.get(node);
  }

  getTreeItem(node: BranchNode): vscode.TreeItem {
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(SECTION_LABEL[node.section], vscode.TreeItemCollapsibleState.Expanded);
      item.id = `section:${node.section}`;
      item.description = String(node.refs.length);
      return item;
    }
    const { ref } = node;
    const item = new vscode.TreeItem(ref.name, vscode.TreeItemCollapsibleState.None);
    item.id = `ref:${ref.fullName}`;
    item.description = branchDescription(ref, this.now);
    const color = ref.isHead
      ? new vscode.ThemeColor('charts.blue')
      : isStale(ref, this.now)
        ? new vscode.ThemeColor('disabledForeground')
        : undefined;
    item.iconPath = new vscode.ThemeIcon(ref.kind === 'remote' ? 'cloud' : 'git-branch', color);
    const md = new vscode.MarkdownString();
    md.appendMarkdown('**');
    md.appendText(ref.name);
    md.appendMarkdown('**');
    for (const line of branchTooltipLines(ref, this.now)) {
      md.appendMarkdown('\n\n');
      md.appendText(line);
    }
    item.tooltip = md;
    item.accessibilityInformation = { label: `${ref.name}, ${item.description}` };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export class BranchView implements vscode.Disposable {
  private readonly provider = new BranchTreeProvider();
  private readonly treeView: vscode.TreeView<BranchNode>;
  private readonly selectEmitter = new vscode.EventEmitter<GitRef | undefined>();
  readonly onDidSelectBranch: vscode.Event<GitRef | undefined> = this.selectEmitter.event;

  /** reveal() ile programatik seçilen ad; bu seçimden doğan olay dışarı verilmez (döngü olmasın). */
  private suppressName: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.treeView = vscode.window.createTreeView('rewiewrev.branches', {
      treeDataProvider: this.provider,
      showCollapseAll: false,
    });
    this.disposables.push(
      this.treeView,
      this.selectEmitter,
      this.treeView.onDidChangeSelection((e) => {
        const node = e.selection[0];
        const ref = node?.kind === 'ref' ? node.ref : undefined;
        if (this.suppressName !== undefined) {
          const expected = this.suppressName;
          this.suppressName = undefined;
          if (ref?.name === expected) return;
        }
        this.selectEmitter.fire(ref);
      }),
    );
  }

  update(refs: GitRef[] | undefined, message?: string): void {
    this.provider.setRefs(refs ?? []);
    const empty = this.provider.sections.length === 0;
    this.treeView.message = message ?? (empty && refs ? 'Bu repoda branch yok.' : undefined);
  }

  reveal(name: string | undefined): void {
    if (name === undefined) return; // TreeView API'si seçimi kaldırmaya izin vermiyor.
    // Gizli görünümde reveal() yan çubuğu açar; kullanıcı istemeden panel değiştirmeyelim.
    if (!this.treeView.visible) return;
    const node = this.provider.byName.get(name);
    if (!node) return;
    const current = this.treeView.selection[0];
    if (current?.kind === 'ref' && current.ref.name === name) return;
    this.suppressName = name;
    this.treeView.reveal(node, { select: true, focus: false, expand: true }).then(
      undefined,
      () => {
        this.suppressName = undefined;
      },
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.provider.dispose();
  }
}
