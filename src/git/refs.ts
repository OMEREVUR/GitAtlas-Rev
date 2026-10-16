import type { GitRef, RefKind } from '../types';
import { runGit } from './gitRunner';

const MAX_REV_LIST = 100;
const CONCURRENCY = 8;

// for-each-ref %xx hex kaçışını açar: \x1f alan, \x1e kayıt sonu.
const FIELDS = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(*objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(committerdate:unix)',
  '%(*committerdate:unix)',
  '%(creatordate:unix)',
  '%(contents:subject)',
  '%(*contents:subject)',
  '%(authorname)',
  '%(*authorname)',
  '%(symref)',
];
const REF_FORMAT = FIELDS.join('%1f') + '%1e';

interface Pending {
  ref: GitRef;
  base: string;
  baseName: string;
}

/** Lokal/remote branch'ler ve etiketler; lokal ve remote branch'lerde ahead/behind. Boş repoda []. */
export async function listRefs(root: string): Promise<GitRef[]> {
  const raw = await runGit(
    ['-c', 'core.quotepath=off', 'for-each-ref', '--format=' + REF_FORMAT, 'refs/heads', 'refs/remotes', 'refs/tags'],
    root,
  );
  const refs: GitRef[] = [];
  for (const record of raw.split('\x1e')) {
    const line = record.replace(/^\r?\n/, '');
    if (line === '') continue;
    const f = line.split('\x1f');
    const [
      fullName = '',
      shortName = '',
      objectName = '',
      peeledName = '',
      headMark = '',
      upstream = '',
      track = '',
      commitDate = '',
      peeledDate = '',
      creatorDate = '',
      subject = '',
      peeledSubject = '',
      author = '',
      peeledAuthor = '',
      symref = '',
    ] = f;
    // origin/HEAD gibi sembolik ref'ler atlanır.
    if (symref !== '') continue;
    const kind = refKind(fullName);
    if (!kind) continue;
    const peeled = peeledName !== '';
    const ref: GitRef = {
      name: shortName,
      fullName,
      kind,
      hash: peeled ? peeledName : objectName,
      isHead: headMark.trim() === '*',
      date: toMs(peeled ? peeledDate || creatorDate : commitDate || creatorDate),
      subject: peeled ? peeledSubject : subject,
      author: peeled ? peeledAuthor : author,
    };
    // "[gone]": upstream silinmiş, yok sayılır ve varsayılan branch'e göre hesaplanır.
    if (kind === 'local' && upstream !== '' && !track.includes('gone')) {
      ref.upstream = upstream;
      ref.compareTo = upstream;
      ref.ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
      ref.behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
    }
    refs.push(ref);
  }

  const locals = new Map(refs.filter((r) => r.kind === 'local').map((r) => [r.name, r]));
  const defaultBranch = refs.find((r) => r.kind === 'local' && r.isHead) ?? locals.get('main') ?? locals.get('master');

  const pending: Pending[] = [];
  for (const ref of refs) {
    if (ref.kind === 'local') {
      if (ref.compareTo !== undefined || ref.isHead || !defaultBranch || ref === defaultBranch) continue;
      pending.push({ ref, base: defaultBranch.fullName, baseName: defaultBranch.name });
    } else if (ref.kind === 'remote') {
      const slash = ref.name.indexOf('/');
      const local = slash >= 0 ? locals.get(ref.name.slice(slash + 1)) : undefined;
      const base = local ?? defaultBranch;
      if (base) pending.push({ ref, base: base.fullName, baseName: base.name });
    }
  }
  await runLimited(pending.slice(0, MAX_REV_LIST), CONCURRENCY, async ({ ref, base, baseName }) => {
    try {
      const out = await runGit(['rev-list', '--left-right', '--count', `${base}...${ref.fullName}`, '--'], root);
      const [left, right] = out.trim().split(/\s+/).map(Number);
      if (left === undefined || right === undefined || !Number.isFinite(left) || !Number.isFinite(right)) return;
      ref.behind = left;
      ref.ahead = right;
      ref.compareTo = baseName;
    } catch {
      // Tek ref'in hatası listeyi düşürmez; ahead/behind boş kalır.
    }
  });
  return refs;
}

function refKind(fullName: string): RefKind | null {
  if (fullName.startsWith('refs/heads/')) return 'local';
  if (fullName.startsWith('refs/remotes/')) return 'remote';
  if (fullName.startsWith('refs/tags/')) return 'tag';
  return null;
}

function toMs(unix: string): number {
  const n = Number(unix);
  return unix !== '' && Number.isFinite(n) ? n * 1000 : 0;
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
