import * as vscode from 'vscode';
import type { TimeRange } from './types';

/** Ayardan bağımsız olarak her zaman hariç tutulan desenler. */
export const DEFAULT_IGNORE: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/*.min.js',
];

export type BadgeMode = 'hot' | 'all' | 'off';
export type PullStrategySetting = 'ask' | 'merge' | 'rebase';

export const DEFAULT_RANGE: TimeRange = '30d';
export const DEFAULT_GRAPH_PAGE_SIZE = 500;
export const MIN_GRAPH_PAGE_SIZE = 100;
export const MAX_GRAPH_PAGE_SIZE = 5000;

/** Ayarlarda izlenen anahtarlar; onDidChangeConfiguration'da kullanılır. */
export const CONFIG_KEYS = {
  ignore: 'gitatlas-revrev.ignore',
  defaultRange: 'gitatlas-revrev.defaultRange',
  graphPageSize: 'gitatlas-revrev.graph.initialCommits',
  badges: 'gitatlas-revrev.explorer.badges',
  gitPath: 'gitatlas-revrev.git.path',
  vscodeGitPath: 'git.path',
  pullStrategy: 'gitatlas-revrev.git.pullStrategy',
} as const;

// ---- saf doğrulayıcılar ----

/** Ayardan gelen değeri daraltır: yalnızca boş olmayan string'ler kalır. */
export function sanitizeIgnore(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item === 'string' && item.trim() !== '') out.push(item.trim());
  }
  return out;
}

export function sanitizeRange(value: unknown): TimeRange {
  return value === '7d' || value === '30d' || value === 'all' ? value : DEFAULT_RANGE;
}

/** 100..5000 arasına kırpılmış tamsayı; sayı değilse varsayılan. */
export function sanitizeGraphPageSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_GRAPH_PAGE_SIZE;
  return Math.min(MAX_GRAPH_PAGE_SIZE, Math.max(MIN_GRAPH_PAGE_SIZE, Math.round(value)));
}

export function sanitizeBadgeMode(value: unknown): BadgeMode {
  return value === 'hot' || value === 'all' || value === 'off' ? value : 'hot';
}

export function sanitizePullStrategy(value: unknown): PullStrategySetting {
  return value === 'merge' || value === 'rebase' ? value : 'ask';
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Git yolu: önce `gitatlas-revrev.git.path`, boşsa VS Code'un `git.path` ayarı
 * (string ya da string[]; dizide ilk dolu eleman), o da boşsa undefined (PATH'teki git).
 */
export function pickGitPath(own: unknown, vscodeGitPath: unknown): string | undefined {
  const mine = nonEmpty(own);
  if (mine) return mine;
  if (Array.isArray(vscodeGitPath)) {
    for (const item of vscodeGitPath as unknown[]) {
      const p = nonEmpty(item);
      if (p) return p;
    }
    return undefined;
  }
  return nonEmpty(vscodeGitPath);
}

// ---- ayar okuyucular ----

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('gitatlas-revrev');
}

/** DEFAULT_IGNORE + `gitatlas-revrev.ignore`. */
export function getIgnoreGlobs(): string[] {
  return [...DEFAULT_IGNORE, ...sanitizeIgnore(cfg().get<unknown>('ignore'))];
}

export function getDefaultRange(): TimeRange {
  return sanitizeRange(cfg().get<unknown>('defaultRange'));
}

export function getGraphPageSize(): number {
  return sanitizeGraphPageSize(cfg().get<unknown>('graph.initialCommits'));
}

export function getBadgeMode(): BadgeMode {
  return sanitizeBadgeMode(cfg().get<unknown>('explorer.badges'));
}

export function getGitPath(): string | undefined {
  return pickGitPath(cfg().get<unknown>('git.path'), vscode.workspace.getConfiguration('git').get<unknown>('path'));
}

export function getPullStrategy(): PullStrategySetting {
  return sanitizePullStrategy(cfg().get<unknown>('git.pullStrategy'));
}
