import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { ChangeKind, LineStat, RepoOperation, StashEntry, WorkingFile, WorkingTreeStatus } from '../types';
import { conflictKindFromXY } from './conflictSides';
import { runGit } from './gitRunner';
import { countLines } from './lineCounter';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const KIND: Record<string, ChangeKind> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
};

/** "a b c rest…" → ilk n alan + kalan (yol boşluk içerebilir). */
function splitFields(s: string, n: number): string[] | undefined {
  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const sp = s.indexOf(' ', pos);
    if (sp < 0) return undefined;
    out.push(s.slice(pos, sp));
    pos = sp + 1;
  }
  out.push(s.slice(pos));
  return out;
}

interface ParsedStatus {
  branch?: string;
  head?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  stashCount: number;
  files: WorkingFile[];
}

/** `git status --porcelain=v2 -z --branch --show-stash` çıktısı. */
export function parsePorcelainV2(raw: string): ParsedStatus {
  const res: ParsedStatus = { ahead: 0, behind: 0, stashCount: 0, files: [] };
  const tokens = raw.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    if (t === '') continue;
    if (t.startsWith('# ')) {
      const [key = '', ...rest] = t.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid' && value !== '(initial)') res.head = value;
      else if (key === 'branch.head' && value !== '(detached)') res.branch = value;
      else if (key === 'branch.upstream') res.upstream = value;
      else if (key === 'branch.ab') {
        res.ahead = Math.abs(Number(/\+(\d+)/.exec(value)?.[1] ?? 0));
        res.behind = Math.abs(Number(/-(\d+)/.exec(value)?.[1] ?? 0));
      } else if (key === 'stash') res.stashCount = Number(value) || 0;
      continue;
    }
    const type = t[0];
    if (type === '?') {
      res.files.push({ path: t.slice(2), unstaged: 'untracked', conflicted: false });
    } else if (type === '1') {
      const f = splitFields(t, 8);
      if (f) res.files.push(ordinary(f[1] ?? '..', f[8] ?? ''));
    } else if (type === '2') {
      const f = splitFields(t, 9);
      // Eski yol bir sonraki NUL alanında.
      const oldPath = tokens[++i] ?? '';
      if (f) res.files.push({ ...ordinary(f[1] ?? '..', f[9] ?? ''), oldPath });
    } else if (type === 'u') {
      const f = splitFields(t, 10);
      if (f) {
        const xy = f[1] ?? '';
        res.files.push({
          path: f[10] ?? '',
          unstaged: xy.includes('D') ? 'deleted' : 'modified',
          conflicted: true,
          conflict: conflictKindFromXY(xy),
        });
      }
    }
  }
  return res;
}

function ordinary(xy: string, p: string): WorkingFile {
  const file: WorkingFile = { path: p, conflicted: false };
  const staged = KIND[xy[0] ?? '.'];
  const unstaged = KIND[xy[1] ?? '.'];
  if (staged) file.staged = staged;
  if (unstaged) file.unstaged = unstaged;
  return file;
}

/** `git diff --numstat -z` → yol → istatistik (binary hariç). */
export function parseNumstatZ(raw: string): Map<string, LineStat> {
  const out = new Map<string, LineStat>();
  const tokens = raw.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    if (t === '') continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(t);
    if (!m) continue;
    let p = m[3] ?? '';
    // Yeniden adlandırma: yol boş, ardından eski ve yeni yol gelir.
    if (p === '') {
      i += 2;
      p = tokens[i] ?? '';
    }
    if (m[1] === '-' || m[2] === '-' || p === '') continue;
    out.set(p, { added: Number(m[1]), deleted: Number(m[2]) });
  }
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function detectOperation(root: string): Promise<RepoOperation | undefined> {
  const names = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'] as const;
  const out = await runGit(['rev-parse', ...names.flatMap((n) => ['--git-path', n])], root);
  const paths = out.split(/\r?\n/).filter((l) => l !== '');
  const flags = await Promise.all(paths.map((p) => exists(path.resolve(root, p))));
  if (flags[0] || flags[1]) return 'rebase';
  if (flags[2]) return 'merge';
  if (flags[3]) return 'cherryPick';
  if (flags[4]) return 'revert';
  return undefined;
}

async function stagedNumstat(root: string): Promise<string> {
  try {
    return await runGit(['-c', 'core.quotepath=off', 'diff', '--cached', '--numstat', '-z', '-M'], root);
  } catch {
    // HEAD yoksa boş ağaca göre.
    return runGit(['-c', 'core.quotepath=off', 'diff', '--cached', '--numstat', '-z', '-M', EMPTY_TREE], root);
  }
}

async function lastCommit(root: string): Promise<{ hash: string; shortHash: string; message: string } | undefined> {
  try {
    const out = await runGit(['log', '-1', '--format=%H%x1f%h%x1f%s', 'HEAD', '--'], root);
    const [hash = '', shortHash = '', message = ''] = out.replace(/\r?\n$/, '').split('\x1f');
    return hash ? { hash, shortHash, message } : undefined;
  } catch {
    return undefined;
  }
}

async function isPushed(root: string): Promise<boolean> {
  try {
    await runGit(['merge-base', '--is-ancestor', 'HEAD', '@{u}'], root);
    return true;
  } catch {
    return false;
  }
}

/** Çalışma ağacı durumu: dosyalar, satır istatistikleri, branch/upstream, devam eden işlem, son commit. */
export async function getStatus(root: string): Promise<WorkingTreeStatus> {
  const [rawStatus, rawStaged, rawUnstaged, operation, last, pushed] = await Promise.all([
    runGit(['-c', 'core.quotepath=off', 'status', '--porcelain=v2', '-z', '--branch', '--show-stash', '--untracked-files=all'], root),
    stagedNumstat(root),
    runGit(['-c', 'core.quotepath=off', 'diff', '--numstat', '-z'], root),
    detectOperation(root),
    lastCommit(root),
    isPushed(root),
  ]);
  const parsed = parsePorcelainV2(rawStatus);
  const stagedStats = parseNumstatZ(rawStaged);
  const unstagedStats = parseNumstatZ(rawUnstaged);
  const untracked = parsed.files.filter((f) => f.unstaged === 'untracked').map((f) => f.path);
  const untrackedLines = untracked.length ? await countLines(root, untracked) : {};

  for (const f of parsed.files) {
    const s = f.staged ? stagedStats.get(f.path) : undefined;
    if (s) f.stagedStat = s;
    if (f.unstaged === 'untracked') {
      const n = untrackedLines[f.path];
      if (n !== undefined) f.unstagedStat = { added: n, deleted: 0 };
    } else if (f.unstaged) {
      const u = unstagedStats.get(f.path);
      if (u) f.unstagedStat = u;
    }
  }

  const status: WorkingTreeStatus = {
    ahead: parsed.ahead,
    behind: parsed.behind,
    files: parsed.files,
    stashCount: parsed.stashCount,
  };
  if (parsed.branch !== undefined) status.branch = parsed.branch;
  if (parsed.head !== undefined) status.head = parsed.head;
  if (parsed.upstream !== undefined) status.upstream = parsed.upstream;
  if (operation) status.operation = operation;
  if (last && parsed.head !== undefined) {
    status.lastCommit = { ...last, pushed: parsed.upstream !== undefined && pushed };
  }
  return status;
}

/** Stash listesi, en yeniden en eskiye. */
export async function listStashes(root: string): Promise<StashEntry[]> {
  let out: string;
  try {
    out = await runGit(['stash', 'list', '-z', '--format=%gd%x1f%ct%x1f%gs'], root);
  } catch {
    return [];
  }
  const entries: StashEntry[] = [];
  for (const rec of out.split('\0')) {
    const line = rec.replace(/^\r?\n|\r?\n$/g, '');
    if (line === '') continue;
    const [ref = '', ct = '', subject = ''] = line.split('\x1f');
    const idx = /stash@\{(\d+)\}/.exec(ref)?.[1];
    if (idx === undefined) continue;
    const m = /^(?:WIP on|On) (.+?): ([\s\S]*)$/.exec(subject);
    const entry: StashEntry = { index: Number(idx), message: m ? (m[2] ?? '') : subject, date: Number(ct) * 1000 };
    const branch = m?.[1];
    if (branch && branch !== '(no branch)') entry.branch = branch;
    entries.push(entry);
  }
  return entries;
}
