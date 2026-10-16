import './base.css';
import './treemap.css';
import './panel.css';
import './graph.css';
import './layout.css';
import type { ExtensionToWebview, WebviewToExtension } from '../protocol';
import type { CommitSummary, FileStat, GitRef, GraphData, TimeRange } from '../types';
import { branchCommits, filterGraphCommits, graphAuthors } from '../model/graphSelect';
import { renderCommitDetail, type GraphSelection } from './commitDetail';
import { renderCommitFeed } from './commitFeed';
import { renderFileCard } from './fileCard';
import { renderGraphToolbar, type GraphFilters } from './graphToolbar';
import { renderGraph } from './graphView';
import { heatLevels } from './heat';
import { renderRangeFilter } from './rangeFilter';
import { renderState, type PanelState } from './states';
import { renderTreemap } from './treemap';

interface VsCodeApi {
  postMessage(msg: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface Model {
  range: TimeRange;
  repoName: string;
  files: FileStat[];
  commits: CommitSummary[];
}

type View = 'map' | 'graph';

interface UiState {
  view: View;
  root: string;
  selectedPath?: string;
  /** Seçili commit (akıştan ya da graph'tan). selectedBranch ile birlikte dolu olmaz. */
  selectedHash?: string;
  /** Seçili branch adı (Branch'ler panelinden). */
  selectedBranch?: string;
  /** Graph'ın kendi tarih filtresi; haritanın aralığından bağımsız. */
  graphRange: TimeRange;
  filters: GraphFilters;
}

const GRAPH_PAGE = 500;
const DAY = 864e5;

const vscode = acquireVsCodeApi();
const post = (msg: WebviewToExtension): void => vscode.postMessage(msg);

let model: Model | undefined;
let panelState: PanelState | undefined = { kind: 'loading', progress: 0 };
let ui: UiState = restoreUi();
let byPath = new Map<string, FileStat>();
let heat = heatLevels([]);

let graph: GraphData | undefined;
let graphLoading = false;
let graphError: string | undefined;
let graphRequested = false;

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function isRange(v: unknown): v is TimeRange {
  return v === '7d' || v === '30d' || v === 'all';
}

function restoreUi(): UiState {
  const s = vscode.getState();
  const o = typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {};
  const f = typeof o.filters === 'object' && o.filters !== null ? (o.filters as Record<string, unknown>) : {};
  return {
    view: o.view === 'graph' ? 'graph' : 'map',
    root: str(o.root) ?? '',
    selectedPath: str(o.selectedPath),
    selectedHash: str(o.selectedHash),
    selectedBranch: str(o.selectedBranch),
    graphRange: isRange(o.graphRange) ? o.graphRange : 'all',
    filters: { branch: str(f.branch), author: str(f.author), query: str(f.query) ?? '', plain: f.plain === true },
  };
}

// ---- Düzen ----
const app = document.getElementById('app') ?? document.body;
app.classList.add('rr-app');
app.replaceChildren();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

const progressEl = el('div', 'rr-topprogress');
progressEl.setAttribute('role', 'progressbar');
progressEl.setAttribute('aria-label', 'Yenileniyor');
const progressFill = el('div', 'rr-topprogress-fill');
progressEl.append(progressFill);

const toolbar = el('div', 'rr-toolbar');
const tabs = el('nav', 'rr-tabs');
tabs.setAttribute('aria-label', 'Görünüm');
const tabButtons: Record<View, HTMLButtonElement> = { map: tabButton('Harita', 'map'), graph: tabButton('Graph', 'graph') };
tabs.append(tabButtons.map, tabButtons.graph);
const rangeHost = el('div', 'rr-range');
const refreshBtn = document.createElement('button');
refreshBtn.className = 'rr-iconbtn';
refreshBtn.type = 'button';
refreshBtn.title = 'Yenile';
refreshBtn.setAttribute('aria-label', 'Yenile');
const refreshIcon = el('span', 'codicon codicon-refresh');
refreshIcon.setAttribute('aria-hidden', 'true');
refreshBtn.append(refreshIcon);
refreshBtn.addEventListener('click', () => post({ type: 'refresh' }));
toolbar.append(tabs, rangeHost, el('div', 'rr-spacer'), refreshBtn);

function tabButton(label: string, view: View): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rr-tab';
  b.textContent = label;
  b.addEventListener('click', () => setView(view));
  return b;
}

// Harita görünümü
const body = el('div', 'rr-body');
const selBar = el('div', 'rr-selbar');
selBar.setAttribute('role', 'status');
const mapHost = el('section', 'rr-map');
mapHost.setAttribute('aria-label', 'Repo haritası');
const feedHost = el('aside', 'rr-feed');
feedHost.setAttribute('aria-label', "Son commit'ler");
const cardHost = el('section', 'rr-card');
cardHost.setAttribute('aria-label', 'Dosya kartı');
body.append(selBar, mapHost, feedHost, cardHost);

// Graph görünümü
const gbody = el('div', 'rr-gbody');
const gtoolHost = el('div', 'rr-gtool');
const glistHost = el('section', 'rr-glist');
glistHost.setAttribute('aria-label', 'Commit graph');
const gdetailHost = el('aside', 'rr-gdetail');
gdetailHost.setAttribute('aria-label', 'Seçim ayrıntısı');
const gnoteHost = el('div', 'rr-gnote');
gnoteHost.setAttribute('role', 'status');
gbody.append(gtoolHost, glistHost, gdetailHost);

const stateHost = el('div', 'rr-state');

app.append(progressEl, toolbar, body, gbody, stateHost);

// ---- Durum güncelleme ----
function saveUi(): void {
  vscode.setState(ui);
}

function setUi(patch: Partial<UiState>): void {
  ui = { ...ui, ...patch };
  saveUi();
  render();
}

function setView(view: View): void {
  setUi({ view });
  if (view === 'graph') ensureGraph();
}

function requestGraph(limit: number): void {
  graphRequested = true;
  graphLoading = true;
  graphError = undefined;
  post({ type: 'loadGraph', branch: ui.filters.branch, limit });
}

function ensureGraph(): void {
  if (!graphRequested) requestGraph(GRAPH_PAGE);
}

function allCommits(): CommitSummary[] {
  return graph ? graph.commits : model?.commits ?? [];
}

function findCommit(hash: string): CommitSummary | undefined {
  return graph?.commits.find((c) => c.hash === hash) ?? model?.commits.find((c) => c.hash === hash);
}

function findRef(name: string): GitRef | undefined {
  return graph?.refs.find((r) => r.name === name && r.kind !== 'tag');
}

function currentSelection(): GraphSelection | undefined {
  if (ui.selectedBranch && graph) {
    const ref = findRef(ui.selectedBranch);
    if (ref) return { kind: 'branch', ref, commits: branchCommits(ref, graph.refs, graph.commits, graph.head) };
  }
  if (ui.selectedHash) {
    const commit = findCommit(ui.selectedHash);
    if (commit) return { kind: 'commit', commit, refs: graph?.refs.filter((r) => r.hash === commit.hash) ?? [] };
  }
  return undefined;
}

function highlightSet(selection = currentSelection()): Set<string> {
  if (!selection) return new Set();
  const commits = selection.kind === 'commit' ? [selection.commit] : selection.commits;
  return new Set(commits.flatMap((c) => c.files.map((f) => f.path)));
}

function rootExists(root: string): boolean {
  if (root === '' || !model) return true;
  const prefix = root + '/';
  return model.files.some((f) => f.path.startsWith(prefix));
}

function selectCommit(hash: string | undefined): void {
  setUi({ selectedHash: hash, selectedBranch: undefined });
}

/** Seçimin haritada bulunan dosyaları; hiçbiri yoksa boş küme (harita boşuna soluklaşmasın). */
function mapHighlight(selection = currentSelection()): Set<string> {
  return new Set([...highlightSet(selection)].filter((p) => byPath.has(p)));
}

function renderSelectionBar(): void {
  const selection = currentSelection();
  selBar.hidden = !selection;
  if (!selection) return;
  const all = highlightSet(selection);
  const inMap = mapHighlight(selection).size;
  const text = el('span', 'rr-selbar-text');
  const what =
    selection.kind === 'branch'
      ? `${selection.ref.name} branch'i seçili · ${selection.commits.length} commit`
      : `${selection.commit.shortHash} commit'i seçili`;
  let where = ` · haritada ${inMap}/${all.size} dosya`;
  if (all.size > inMap) where += ` (${all.size - inMap} dosya bu çalışma ağacında yok)`;
  text.textContent = what + where;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'rr-selbar-clear';
  clear.textContent = 'Seçimi kaldır';
  clear.addEventListener('click', () => setUi({ selectedHash: undefined, selectedBranch: undefined }));
  selBar.replaceChildren(text, clear);
}

function renderMap(): void {
  if (!model || ui.view !== 'map') return;
  renderTreemap(mapHost, model.files, {
    root: ui.root,
    repoName: model.repoName,
    highlight: mapHighlight(),
    selected: ui.selectedPath,
    onSelect: (path) => setUi({ selectedPath: path }),
    onOpen: (path) => post({ type: 'openFile', path }),
    onNavigate: (folder) => setUi({ root: folder }),
  });
}

function graphVisible(): Set<string> | undefined {
  if (!graph) return undefined;
  const f = ui.filters;
  const since = ui.graphRange === 'all' ? undefined : Date.now() - (ui.graphRange === '7d' ? 7 : 30) * DAY;
  if (!f.author && !f.query.trim() && since === undefined) return undefined;
  return filterGraphCommits(graph.commits, { author: f.author, query: f.query.trim() || undefined, since });
}

function renderGraphView(now: number): void {
  if (!model) return;
  const refs = graph?.refs ?? [];
  renderGraphToolbar(gtoolHost, {
    refs,
    authors: graphAuthors(allCommits()),
    filters: ui.filters,
    onChange: (f) => {
      const branchChanged = f.branch !== ui.filters.branch;
      setUi({ filters: f });
      if (branchChanged) requestGraph(GRAPH_PAGE);
    },
  });

  const selection = currentSelection();
  const highlight = highlightSet(selection);

  if (graph) {
    const visible = graphVisible();
    renderGraph(glistHost, graph, {
      plain: ui.filters.plain || visible !== undefined,
      selectedHash: ui.selectedHash,
      branchHashes: selection?.kind === 'branch' ? new Set(selection.commits.map((c) => c.hash)) : undefined,
      visible,
      now,
      loadingMore: graphLoading,
      onSelectCommit: (hash) => selectCommit(hash),
      onLoadMore: () => {
        if (graph && !graphLoading) {
          requestGraph(graph.limit + GRAPH_PAGE);
          render();
        }
      },
    });
    if (visible !== undefined && !ui.filters.plain) {
      gnoteHost.textContent = 'Filtre açıkken şeritler gizlenir.';
      glistHost.prepend(gnoteHost);
    }
  } else {
    const msg = el('div', 'rr-gempty');
    msg.textContent = graphError ? `Graph yüklenemedi: ${graphError}` : 'Graph yükleniyor…';
    if (graphError) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'rr-gretry';
      retry.textContent = 'Yeniden dene';
      retry.addEventListener('click', () => requestGraph(GRAPH_PAGE));
      msg.append(retry);
    }
    glistHost.replaceChildren(msg);
  }

  const files = model.files;
  renderCommitDetail(gdetailHost, selection, post, {
    now,
    touchedCount: [...highlight].filter((p) => byPath.has(p)).length,
    totalCount: files.length,
    renderMiniMap: (host) =>
      renderTreemap(host, files, {
        root: '',
        repoName: model?.repoName ?? '',
        highlight: mapHighlight(selection),
        compact: true,
        onSelect: (path) => setUi({ view: 'map', root: '', selectedPath: path }),
        onOpen: (path) => post({ type: 'openFile', path }),
        onNavigate: () => undefined,
      }),
    onShowInMap: () => setUi({ view: 'map', root: '' }),
    onClear: () => setUi({ selectedHash: undefined, selectedBranch: undefined }),
  });
}

function render(): void {
  const hasModel = model !== undefined;
  const fullState = !hasModel ? panelState : panelState?.kind === 'error' ? panelState : undefined;

  stateHost.hidden = fullState === undefined;
  toolbar.hidden = fullState !== undefined;
  body.hidden = fullState !== undefined || ui.view !== 'map';
  gbody.hidden = fullState !== undefined || ui.view !== 'graph';
  if (fullState) renderState(stateHost, fullState, post);

  const refreshing = (hasModel && panelState?.kind === 'loading') || (ui.view === 'graph' && graphLoading);
  progressEl.hidden = !refreshing;
  const progress = panelState?.kind === 'loading' ? panelState.progress : 0.5;
  progressFill.style.setProperty('width', `${Math.round(progress * 100)}%`);
  progressEl.setAttribute('aria-valuenow', String(Math.round(progress * 100)));

  for (const v of ['map', 'graph'] as View[]) {
    tabButtons[v].setAttribute('aria-pressed', String(ui.view === v));
  }

  if (!model || fullState) return;
  const now = Date.now();
  if (ui.view === 'map') {
    renderRangeFilter(rangeHost, model.range, (r) => post({ type: 'setRange', range: r }));
    renderSelectionBar();
    renderMap();
    renderCommitFeed(feedHost, model.commits, {
      selectedHash: ui.selectedHash,
      now,
      onSelectCommit: (hash) => selectCommit(hash),
    });
    const file = ui.selectedPath ? byPath.get(ui.selectedPath) : undefined;
    renderFileCard(cardHost, file, model.commits, post, {
      range: model.range,
      heat: file ? heat.get(file.path) ?? 0 : 0,
      now,
      onClose: () => setUi({ selectedPath: undefined }),
    });
  } else {
    renderRangeFilter(rangeHost, ui.graphRange, (r) => setUi({ graphRange: r }));
    renderGraphView(now);
  }
}

window.addEventListener('message', (e: MessageEvent<ExtensionToWebview>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'loading':
      panelState = { kind: 'loading', progress: msg.progress };
      break;
    case 'error':
      panelState = { kind: 'error', code: msg.code, message: msg.message };
      break;
    case 'model':
      model = { range: msg.range, repoName: msg.repoName, files: msg.files, commits: msg.commits };
      panelState = undefined;
      byPath = new Map(msg.files.map((f) => [f.path, f]));
      heat = heatLevels(msg.files);
      if (!rootExists(ui.root)) ui.root = '';
      saveUi();
      autoSelectForPreview();
      if (ui.view === 'graph' || ui.selectedBranch) ensureGraph();
      break;
    case 'graphLoading':
      graphRequested = true;
      graphLoading = true;
      break;
    case 'graph':
      graph = msg.graph;
      graphLoading = false;
      graphError = undefined;
      graphRequested = true;
      if (ui.selectedHash && !findCommit(ui.selectedHash)) ui.selectedHash = undefined;
      if (ui.selectedBranch && !findRef(ui.selectedBranch)) ui.selectedBranch = undefined;
      saveUi();
      break;
    case 'graphError':
      graphLoading = false;
      graphError = msg.message;
      break;
    case 'selectBranch':
      ui = { ...ui, selectedBranch: msg.name, selectedHash: msg.name ? undefined : ui.selectedHash };
      saveUi();
      if (msg.name) ensureGraph();
      break;
  }
  render();
});

// Treemap el'in boyutuna göre çizilir; boyut değişince yeniden çiz.
let resizeFrame = 0;
let lastSize = '';
new ResizeObserver(() => {
  const size = `${mapHost.clientWidth}x${mapHost.clientHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderMap);
}).observe(mapHost);

/**
 * Yalnızca dev/preview.html: <body data-autoselect="first-commit"> ilk commit'i,
 * <body data-autoselect="branch:<ad>"> bir branch'i seçer (ekran görüntüsü testi).
 */
let autoSelected = false;
function autoSelectForPreview(): void {
  if (autoSelected || !model) return;
  const mode = document.body.dataset.autoselect;
  if (!mode) return;
  autoSelected = true;
  if (mode.startsWith('branch:')) {
    ui.selectedBranch = mode.slice('branch:'.length);
    ui.selectedHash = undefined;
    return;
  }
  const c = model.commits.find((x) => x.files.length > 0);
  if (!c) return;
  ui.selectedHash = c.hash;
  ui.selectedBranch = undefined;
  ui.selectedPath = c.files.find((f) => byPath.has(f.path))?.path;
}

render();
post({ type: 'ready' });
