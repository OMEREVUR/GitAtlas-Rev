import type { CommitFileChange, CommitSummary } from '../types';

const RS = '\x1e';
const FS = '\x1f';

/** Kayıt başı \x1e, alan ayracı \x1f: hash, kısa hash, parent'lar, yazar, e-posta (.mailmap uygulanmış), tarih (sn), konu. */
export const LOG_FORMAT = RS + ['%H', '%h', '%P', '%aN', '%aE', '%at', '%s'].join(FS);

/** repoService'in çağıracağı tam `git` argümanları. Çıktı en yeniden en eskiye. */
export function logArgs(revisionRange?: string): string[] {
  return [
    '-c',
    'core.quotepath=off',
    'log',
    '--numstat',
    '-M',
    '--no-color',
    '--format=' + LOG_FORMAT,
    ...(revisionRange ? [revisionRange] : []),
  ];
}

export function parseNumstatLog(raw: string): CommitSummary[] {
  const commits: CommitSummary[] = [];
  for (const record of raw.split(RS)) {
    if (record.trim() === '') continue;
    const lines = record.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
    const fields = (lines[0] ?? '').split(FS);
    if (fields.length < 7) continue;
    const [hash = '', shortHash = '', parents = '', author = '', email = '', at = ''] = fields;
    // Konu \x1f içerirse kaybolmasın.
    const message = fields.slice(6).join(FS);
    const files: CommitFileChange[] = [];
    for (let i = 1; i < lines.length; i++) {
      const change = parseNumstatLine(lines[i] ?? '');
      if (change) files.push(change);
    }
    commits.push({
      hash,
      shortHash,
      parents: parents.split(' ').filter((p) => p !== ''),
      author,
      email,
      date: Number(at) * 1000,
      message,
      files,
    });
  }
  return commits;
}

function parseNumstatLine(line: string): CommitFileChange | null {
  const t1 = line.indexOf('\t');
  if (t1 < 0) return null;
  const t2 = line.indexOf('\t', t1 + 1);
  if (t2 < 0) return null;
  const addedRaw = line.slice(0, t1);
  const deletedRaw = line.slice(t1 + 1, t2);
  const pathRaw = line.slice(t2 + 1);
  if (pathRaw === '') return null;
  // Binary: "-\t-\tpath" → 0/0.
  const added = addedRaw === '-' ? 0 : Number(addedRaw);
  const deleted = deletedRaw === '-' ? 0 : Number(deletedRaw);
  if (!Number.isFinite(added) || !Number.isFinite(deleted)) return null;

  const rename = parseRename(pathRaw);
  if (rename) return { path: rename.path, oldPath: rename.oldPath, added, deleted };
  return { path: unquote(pathRaw), added, deleted };
}

/** "old => new", "src/{a => b}/x.ts", "{ => sub}/x.ts", "src/{old => }/x.ts". */
function parseRename(raw: string): { path: string; oldPath: string } | null {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (brace) {
    const [, prefix = '', from = '', to = '', suffix = ''] = brace;
    return {
      oldPath: unquote(joinRenamePart(prefix, from, suffix)),
      path: unquote(joinRenamePart(prefix, to, suffix)),
    };
  }
  const idx = raw.indexOf(' => ');
  if (idx < 0) return null;
  return { oldPath: unquote(raw.slice(0, idx)), path: unquote(raw.slice(idx + 4)) };
}

function joinRenamePart(prefix: string, middle: string, suffix: string): string {
  if (middle !== '') return prefix + middle + suffix;
  // Boş tarafta çift "/" oluşmasın.
  if (suffix.startsWith('/')) return prefix + suffix.slice(1);
  if (prefix.endsWith('/')) return prefix.slice(0, -1) + suffix;
  return prefix + suffix;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Git'in C tarzı tırnaklı yollarını ("a\tb", "\303\247") çözer. */
function unquote(p: string): string {
  if (p.length < 2 || !p.startsWith('"') || !p.endsWith('"')) return p;
  const bytes: number[] = [];
  const body = p.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? '';
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const rest = body.slice(i + 1);
    const oct = /^[0-7]{1,3}/.exec(rest)?.[0];
    if (oct) {
      bytes.push(parseInt(oct, 8));
      i += oct.length;
      continue;
    }
    const next = rest[0] ?? '';
    const code = ESCAPES[next];
    if (code !== undefined) bytes.push(code);
    else bytes.push(...Buffer.from(next, 'utf8'));
    i += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}
