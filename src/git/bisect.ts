// 0.4.0: git bisect durumu. Ayrıştırma saf; getBisectState .git içindeki bisect dosyalarını okur.
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { BisectMark, BisectMarkKind, BisectState } from '../types';
import { runGit } from './gitRunner';

const MAX_CANDIDATES = 5000;

export interface ParsedBisectLog {
  marks: BisectMark[];
  firstBad?: string;
}

/**
 * BISECT_LOG: her işaret "# good: [hash] başlık" biçiminde yorum satırı olarak yazılır;
 * bulununca "# first bad commit: [hash] başlık" eklenir.
 */
export function parseBisectLog(text: string): ParsedBisectLog {
  const out: ParsedBisectLog = { marks: [] };
  for (const line of text.split(/\r?\n/)) {
    const first = /^# first bad commit: \[([0-9a-f]{4,64})\]/i.exec(line);
    if (first) {
      out.firstBad = first[1];
      continue;
    }
    const m = /^# (good|bad|skip): \[([0-9a-f]{4,64})\]\s?(.*)$/i.exec(line);
    if (m) {
      const subject = (m[3] ?? '').trim();
      const mark: BisectMark = { hash: m[2] ?? '', mark: (m[1] ?? 'skip').toLowerCase() as BisectMarkKind };
      if (subject) mark.subject = subject;
      out.marks.push(mark);
    }
  }
  return out;
}

/** Aday sayısından tahmini kalan adım: 1 aday (ya da hiç) → 0, aksi hâlde ⌈log2(n)⌉. */
export function remainingSteps(candidates: number): number {
  return candidates <= 1 ? 0 : Math.ceil(Math.log2(candidates));
}

/** `git for-each-ref refs/bisect` → kötü, iyiler, atlananlar. */
export function parseBisectRefs(raw: string): { bad?: string; goods: string[]; skips: string[] } {
  const out: { bad?: string; goods: string[]; skips: string[] } = { goods: [], skips: [] };
  for (const line of raw.split(/\r?\n/)) {
    const [name = '', hash = ''] = line.trim().split(/\s+/);
    if (!hash) continue;
    if (name === 'refs/bisect/bad') out.bad = hash;
    else if (name.startsWith('refs/bisect/good')) out.goods.push(hash);
    else if (name.startsWith('refs/bisect/skip')) out.skips.push(hash);
  }
  return out;
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Süren bisect'in durumu; bisect yoksa undefined. Terminalden başlatılmış bisect'i de görür. */
export async function getBisectState(root: string): Promise<BisectState | undefined> {
  const [startPath = '', logPath = ''] = (await runGit(['rev-parse', '--git-path', 'BISECT_START', '--git-path', 'BISECT_LOG'], root))
    .split(/\r?\n/)
    .filter((l) => l !== '');
  const start = await readOptional(path.resolve(root, startPath));
  if (start === undefined) return undefined;
  const [log, refsRaw, head] = await Promise.all([
    readOptional(path.resolve(root, logPath)),
    runGit(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/bisect'], root),
    runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root).catch(() => ''),
  ]);
  const parsed = parseBisectLog(log ?? '');
  const refs = parseBisectRefs(refsRaw);
  const state: BisectState = {
    startRef: start.trim(),
    goods: refs.goods,
    skips: refs.skips,
    candidates: [],
    candidateCount: 0,
    steps: 0,
    marks: parsed.marks,
  };
  if (refs.bad) state.bad = refs.bad;
  if (head.trim()) state.current = head.trim();
  if (parsed.firstBad) state.firstBad = parsed.firstBad;
  if (refs.bad && refs.goods.length > 0) {
    const list = (await runGit(['rev-list', refs.bad, '--not', ...refs.goods], root)).split(/\r?\n/).filter((l) => l !== '');
    state.candidateCount = list.length;
    state.candidates = list.slice(0, MAX_CANDIDATES);
    state.steps = parsed.firstBad ? 0 : remainingSteps(list.filter((h) => !refs.skips.includes(h)).length);
  }
  return state;
}
