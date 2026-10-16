import './base.css';
import './treemap.css';
import './panel.css';
import './layout.css';
import type { ExtensionToWebview, WebviewToExtension } from '../protocol';
import type { CommitSummary, FileStat, TimeRange } from '../types';
import { renderCommitFeed } from './commitFeed';
import { renderFileCard } from './fileCard';
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

interface UiState {
  root: string;
  selectedPath?: string;
  selectedHash?: string;
}

const vscode = acquireVsCodeApi();
const post = (msg: WebviewToExtension): void => vscode.postMessage(msg);

let model: Model | undefined;
let panelState: PanelState | undefined = { kind: 'loading', progress: 0 };
let ui: UiState = restoreUi();
let byPath = new Map<string, FileStat>();
let heat = heatLevels([]);

function restoreUi(): UiState {
  const s = vscode.getState();
  if (typeof s === 'object' && s !== null) {
    const o = s as Record<string, unknown>;
    return {
      root: typeof o.root === 'string' ? o.root : '',
      selectedPath: typeof o.selectedPath === 'string' ? o.selectedPath : undefined,
      selectedHash: typeof o.selectedHash === 'string' ? o.selectedHash : undefined,
    };
  }
  return { root: '' };
}

// ---- Düzen ----
const app = document.getElementById('app') ?? document.body;
app.classList.add('rr-app');
app.replaceChildren();

const progressEl = el('div', 'rr-topprogress');
progressEl.setAttribute('role', 'progressbar');
progressEl.setAttribute('aria-label', 'Yenileniyor');
const progressFill = el('div', 'rr-topprogress-fill');
progressEl.append(progressFill);

const toolbar = el('div', 'rr-toolbar');
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
toolbar.append(rangeHost, el('div', 'rr-spacer'), refreshBtn);

const body = el('div', 'rr-body');
const mapHost = el('section', 'rr-map');
mapHost.setAttribute('aria-label', 'Repo haritası');
const feedHost = el('aside', 'rr-feed');
feedHost.setAttribute('aria-label', "Son commit'ler");
const cardHost = el('section', 'rr-card');
cardHost.setAttribute('aria-label', 'Dosya kartı');
body.append(mapHost, feedHost, cardHost);

const stateHost = el('div', 'rr-state');

app.append(progressEl, toolbar, body, stateHost);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

// ---- Durum güncelleme ----
function saveUi(): void {
  vscode.setState(ui);
}

function setUi(patch: Partial<UiState>): void {
  ui = { ...ui, ...patch };
  saveUi();
  render();
}

function highlightSet(): Set<string> {
  const c = ui.selectedHash ? model?.commits.find((x) => x.hash === ui.selectedHash) : undefined;
  return new Set(c ? c.files.map((f) => f.path) : []);
}

function rootExists(root: string): boolean {
  if (root === '' || !model) return true;
  const prefix = root + '/';
  return model.files.some((f) => f.path.startsWith(prefix));
}

function renderMap(): void {
  if (!model) return;
  renderTreemap(mapHost, model.files, {
    root: ui.root,
    repoName: model.repoName,
    highlight: highlightSet(),
    selected: ui.selectedPath,
    onSelect: (path) => setUi({ selectedPath: path }),
    onOpen: (path) => post({ type: 'openFile', path }),
    onNavigate: (folder) => setUi({ root: folder }),
  });
}

function render(): void {
  const hasModel = model !== undefined;
  const fullState = !hasModel ? panelState : panelState?.kind === 'error' ? panelState : undefined;

  stateHost.hidden = fullState === undefined;
  toolbar.hidden = body.hidden = fullState !== undefined;
  if (fullState) renderState(stateHost, fullState, post);

  const refreshing = hasModel && panelState?.kind === 'loading';
  progressEl.hidden = !refreshing;
  if (panelState?.kind === 'loading') {
    progressFill.style.setProperty('width', `${Math.round(panelState.progress * 100)}%`);
    progressEl.setAttribute('aria-valuenow', String(Math.round(panelState.progress * 100)));
  }

  if (!model || fullState) return;
  const now = Date.now();
  renderRangeFilter(rangeHost, model.range, (r) => post({ type: 'setRange', range: r }));
  renderMap();
  renderCommitFeed(feedHost, model.commits, {
    selectedHash: ui.selectedHash,
    now,
    onSelectCommit: (hash) => setUi({ selectedHash: hash }),
  });
  const file = ui.selectedPath ? byPath.get(ui.selectedPath) : undefined;
  renderFileCard(cardHost, file, model.commits, post, {
    range: model.range,
    heat: file ? heat.get(file.path) ?? 0 : 0,
    now,
    onClose: () => setUi({ selectedPath: undefined }),
  });
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
      if (ui.selectedHash && !msg.commits.some((c) => c.hash === ui.selectedHash)) ui.selectedHash = undefined;
      saveUi();
      autoSelectForPreview();
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

/** Yalnızca dev/preview.html: <body data-autoselect="first-commit"> ile ilk commit seçilir (ekran görüntüsü testi). */
let autoSelected = false;
function autoSelectForPreview(): void {
  if (autoSelected || !model) return;
  const mode = document.body.dataset.autoselect;
  if (mode !== 'first-commit') return;
  autoSelected = true;
  const c = model.commits.find((x) => x.files.length > 0);
  if (!c) return;
  ui.selectedHash = c.hash;
  ui.selectedPath = c.files.find((f) => byPath.has(f.path))?.path;
}

render();
post({ type: 'ready' });
