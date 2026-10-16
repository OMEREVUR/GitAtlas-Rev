import { LOG_FORMAT } from './logParser';

/** Graph için `git log` argümanları; çıktı parseNumstatLog ile ayrıştırılır. --all yok (stash/notes girmesin). */
export function graphLogArgs(opts: { limit: number; branch?: string }): string[] {
  return [
    '-c',
    'core.quotepath=off',
    'log',
    '--topo-order',
    '--numstat',
    '-M',
    '--no-color',
    '--format=' + LOG_FORMAT,
    '-n',
    String(opts.limit),
    ...(opts.branch ? [opts.branch] : ['--branches', '--remotes', '--tags', 'HEAD']),
    '--',
  ];
}
