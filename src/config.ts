import * as vscode from 'vscode';

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

/** Ayardan gelen değeri daraltır: yalnızca boş olmayan string'ler kalır. */
export function sanitizeIgnore(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item === 'string' && item.trim() !== '') out.push(item.trim());
  }
  return out;
}

/** DEFAULT_IGNORE + `rewiewrev.ignore`. */
export function getIgnoreGlobs(): string[] {
  const user = sanitizeIgnore(vscode.workspace.getConfiguration('rewiewrev').get<unknown>('ignore'));
  return [...DEFAULT_IGNORE, ...user];
}
