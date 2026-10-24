import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// vscode taklidi: workspace klasörleri, durum çubuğu ve aktif düzenleyici olayı testten yönetilir.
const h = vi.hoisted(() => ({
  folders: [] as { uri: { scheme: string; fsPath: string } }[],
  editorListener: undefined as ((e: unknown) => void) | undefined,
  item: { text: '', tooltip: '', visible: false },
  warnings: [] as string[],
}));

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: ((v: T) => void)[] = [];
    event = (l: (v: T) => void): { dispose: () => void } => {
      this.listeners.push(l);
      return { dispose: () => undefined };
    };
    fire(v: T): void {
      this.listeners.forEach((l) => l(v));
    }
    dispose(): void {}
  }
  return {
    EventEmitter,
    StatusBarAlignment: { Left: 1 },
    QuickPickItemKind: { Separator: -1 },
    Uri: { file: (p: string) => ({ fsPath: resolve(p), scheme: 'file' }) },
    workspace: {
      get workspaceFolders() {
        return h.folders;
      },
      getConfiguration: () => ({ get: () => undefined }),
    },
    window: {
      createStatusBarItem: () => ({
        set text(v: string) {
          h.item.text = v;
        },
        set tooltip(v: string) {
          h.item.tooltip = v;
        },
        name: '',
        command: '',
        show: () => {
          h.item.visible = true;
        },
        hide: () => {
          h.item.visible = false;
        },
        dispose: () => undefined,
      }),
      onDidChangeActiveTextEditor: (l: (e: unknown) => void) => {
        h.editorListener = l;
        return { dispose: () => undefined };
      },
      showWarningMessage: (m: string) => {
        h.warnings.push(m);
        return Promise.resolve(undefined);
      },
      showInformationMessage: () => Promise.resolve(undefined),
      showQuickPick: () => Promise.resolve(undefined),
      activeTextEditor: undefined,
    },
  };
});

import { RepoManager } from '../src/panel/repoManager';

function memento(): { get<T>(k: string): T | undefined; update(k: string, v: unknown): Promise<void>; data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: <T,>(k: string) => data.get(k) as T | undefined,
    update: (k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    },
  };
}

const folder = (p: string): { uri: { scheme: string; fsPath: string } } => ({ uri: { scheme: 'file', fsPath: p } });

let base: string;
let api: string;
let web: string;
let plain: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rr-repos-')));
  api = join(base, 'api');
  web = join(base, 'web');
  plain = join(base, 'notes');
  for (const d of [api, web]) {
    mkdirSync(d);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
  }
  mkdirSync(join(api, 'src'));
  mkdirSync(plain);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  h.folders = [];
  h.editorListener = undefined;
  h.item = { text: '', tooltip: '', visible: false };
  h.warnings = [];
});

describe('RepoManager', () => {
  it('workspace klasörlerindeki repoları bulur; repo olmayanı atlar, aynı repoyu bir kez sayar', async () => {
    h.folders = [folder(api), folder(join(api, 'src')), folder(plain), folder(web)];
    const m = new RepoManager(memento(), () => true);
    await m.ensure();
    expect(m.snapshot.repos.map((r) => r.name)).toEqual(['api', 'web']);
    expect(m.currentRoot).toBe(resolve(api));
    expect(h.item.visible).toBe(true);
    expect(h.item.text).toContain('api');
  });

  it('tek repoda durum çubuğu öğesi görünmez', async () => {
    h.folders = [folder(api), folder(plain)];
    const m = new RepoManager(memento(), () => true);
    await m.ensure();
    expect(m.snapshot.repos).toHaveLength(1);
    expect(h.item.visible).toBe(false);
  });

  it('kayıtlı seçimi geri yükler; seçim workspace\'ten çıktıysa ilk repoya döner', async () => {
    h.folders = [folder(api), folder(web)];
    const state = memento();
    state.data.set('gitatlas-revrev.repo', resolve(web));
    const m = new RepoManager(state, () => true);
    await m.ensure();
    expect(m.currentRoot).toBe(resolve(web));

    h.folders = [folder(api)];
    m.markStale();
    await m.ensure();
    expect(m.currentRoot).toBe(resolve(api));
  });

  it('select: geçer, hatırlar ve onDidSelect/onDidChange olaylarını verir', async () => {
    h.folders = [folder(api), folder(web)];
    const state = memento();
    const m = new RepoManager(state, () => true);
    await m.ensure();
    const selected: string[] = [];
    const changes: (string | undefined)[] = [];
    m.onDidSelect((r) => selected.push(r));
    m.onDidChange((s) => changes.push(s.current));
    expect(await m.select(resolve(web))).toBe(true);
    expect(m.currentRoot).toBe(resolve(web));
    expect(state.data.get('gitatlas-revrev.repo')).toBe(resolve(web));
    expect(selected).toEqual([resolve(web)]);
    expect(changes).toEqual([resolve(web)]);
    expect(await m.select(join(base, 'yok'))).toBe(false);
  });

  it('git işlemi sürerken repo değiştirmez ve uyarır', async () => {
    h.folders = [folder(api), folder(web)];
    const m = new RepoManager(memento(), () => false);
    await m.ensure();
    expect(await m.select(resolve(web))).toBe(false);
    expect(m.currentRoot).toBe(resolve(api));
    expect(h.warnings).toHaveLength(1);
  });

  it('takip açıkken açılan dosyanın reposuna geçer; kapalıyken geçmez', async () => {
    h.folders = [folder(api), folder(web)];
    const state = memento();
    const m = new RepoManager(state, () => true);
    await m.ensure();
    const editor = (p: string): unknown => ({ document: { uri: { scheme: 'file', fsPath: p } } });

    h.editorListener?.(editor(join(web, 'index.ts')));
    expect(m.currentRoot).toBe(resolve(api));

    await m.setFollow(true);
    expect(state.data.get('gitatlas-revrev.repo.followActiveFile')).toBe(true);
    h.editorListener?.(editor(join(web, 'index.ts')));
    await Promise.resolve();
    expect(m.currentRoot).toBe(resolve(web));

    // Hiçbir repoda olmayan dosya seçimi değiştirmez.
    h.editorListener?.(editor(join(plain, 'todo.md')));
    await Promise.resolve();
    expect(m.currentRoot).toBe(resolve(web));
  });
});
