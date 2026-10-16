// Katkı paneli verisi. SAF: node/DOM import'u yok, webview de kullanabilir.
import type { AuthorStat, CommitSummary, ContribData, FileExpert, FileStat, ModuleOwnership, TimeRange } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const NESTED_MODULE_RATIO = 0.6;
const MAX_MODULES = 12;
const MAX_EXPERTS = 8;

function rangeSince(range: TimeRange, now: number, commits: CommitSummary[]): number {
  if (range === '7d') return now - 7 * DAY_MS;
  if (range === '30d') return now - 30 * DAY_MS;
  let min = Number.POSITIVE_INFINITY;
  for (const c of commits) if (c.date < min) min = c.date;
  return Number.isFinite(min) ? min : now;
}

/**
 * Dosya → modül. Modül dosyanın ilk klasörüdür; tek bir üst klasör dosyaların %60'ından
 * fazlasını tutuyorsa onun alt klasörleri modül olur (kök dosyaları o klasörün kendisine kalır).
 */
export function moduleResolver(paths: string[]): (path: string) => string {
  const top = (p: string): string => {
    const i = p.indexOf('/');
    return i === -1 ? '' : p.slice(0, i);
  };
  const counts = new Map<string, number>();
  for (const p of paths) {
    const t = top(p);
    if (t !== '') counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let nested: string | undefined;
  for (const [t, n] of counts) if (n > paths.length * NESTED_MODULE_RATIO) nested = t;

  return (p: string): string => {
    const t = top(p);
    if (t === '' || t !== nested) return t;
    const rest = p.slice(t.length + 1);
    const j = rest.indexOf('/');
    return j === -1 ? t : `${t}/${rest.slice(0, j)}`;
  };
}

/** Yerel saatle `ms` anının bulunduğu haftanın pazartesi 00:00'ı. */
function mondayOf(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function inc<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sub<K>(map: Map<K, Map<string, number>>, key: K): Map<string, number> {
  let m = map.get(key);
  if (!m) {
    m = new Map();
    map.set(key, m);
  }
  return m;
}

function argmax<K>(map: Map<K, number>): K | undefined {
  let best: K | undefined;
  let bestN = Number.NEGATIVE_INFINITY;
  for (const [k, n] of map) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

interface AuthorAcc {
  names: Map<string, number>;
  email: string;
  commits: number;
  added: number;
  deleted: number;
  modules: Map<string, number>;
}

export function computeContrib(commits: CommitSummary[], files: FileStat[], range: TimeRange, now: number): ContribData {
  const since = rangeSince(range, now, commits);
  const fileSet = new Map(files.map((f) => [f.path, f]));
  const moduleOf = moduleResolver(files.map((f) => f.path));

  const authors = new Map<string, AuthorAcc>();
  const accFor = (c: CommitSummary): AuthorAcc => {
    const key = c.email.toLowerCase();
    let acc = authors.get(key);
    if (!acc) {
      acc = { names: new Map(), email: c.email, commits: 0, added: 0, deleted: 0, modules: new Map() };
      authors.set(key, acc);
    }
    return acc;
  };

  const moduleTotals = new Map<string, Map<string, number>>();
  const rangeChanges = new Map<string, number>();
  /** Dosya → yazar → tüm geçmişte değişen satır / commit sayısı. */
  const fileLines = new Map<string, Map<string, number>>();
  const fileCommits = new Map<string, Map<string, number>>();

  // Haftalık ritim penceresi.
  const weekCount = range === 'all' ? 12 : 4;
  const thisMonday = mondayOf(now);
  const weekStarts: number[] = [];
  for (let w = weekCount - 1; w >= 0; w--) {
    const d = new Date(thisMonday);
    d.setDate(d.getDate() - 7 * w);
    weekStarts.push(d.getTime());
  }
  const rhythmEnd = new Date(thisMonday);
  rhythmEnd.setDate(rhythmEnd.getDate() + 7);
  const emptyGrid = (): number[][] => weekStarts.map(() => [0, 0, 0, 0, 0, 0, 0]);
  const rhythm: Record<string, number[][]> = { '': emptyGrid() };

  // Eski ad → bugünkü ad; commit'ler yeniden eskiye (aggregate.ts ile aynı kural).
  const alias = new Map<string, string>();
  for (const c of commits) {
    const key = c.email.toLowerCase();
    const acc = accFor(c);
    inc(acc.names, c.author);
    const inRange = c.date >= since && c.date <= now;
    if (inRange) acc.commits++;

    if (c.date >= weekStarts[0]! && c.date < rhythmEnd.getTime()) {
      const monday = mondayOf(c.date).getTime();
      const w = weekStarts.indexOf(monday);
      if (w !== -1) {
        const day = (new Date(c.date).getDay() + 6) % 7;
        rhythm['']![w]![day]!++;
        (rhythm[key] ??= emptyGrid())[w]![day]!++;
      }
    }

    const isMerge = c.parents.length > 1;
    const touched = new Set<string>();
    for (const change of c.files) {
      const target = alias.get(change.path) ?? change.path;
      if (change.oldPath !== undefined && change.oldPath !== change.path) alias.set(change.oldPath, target);
      if (isMerge || !fileSet.has(target)) continue;
      const lines = change.added + change.deleted;

      inc(sub(fileLines, target), key, lines);
      if (!touched.has(target)) inc(sub(fileCommits, target), key);

      if (!inRange) {
        touched.add(target);
        continue;
      }
      if (!touched.has(target)) inc(rangeChanges, target);
      touched.add(target);
      acc.added += change.added;
      acc.deleted += change.deleted;
      const mod = moduleOf(target);
      inc(acc.modules, mod, lines);
      inc(sub(moduleTotals, mod), key, lines);
    }
  }

  const nameOf = (acc: AuthorAcc): string => argmax(acc.names) ?? acc.email;

  const authorStats: AuthorStat[] = [];
  for (const [key, acc] of authors) {
    if (acc.commits === 0) continue;
    const stat: AuthorStat = {
      key,
      name: nameOf(acc),
      email: acc.email,
      commits: acc.commits,
      added: acc.added,
      deleted: acc.deleted,
    };
    const top = argmax(acc.modules);
    if (top !== undefined && (acc.modules.get(top) ?? 0) > 0) stat.topModule = top;
    authorStats.push(stat);
    rhythm[key] ??= emptyGrid();
  }
  authorStats.sort(
    (a, b) => b.commits - a.commits || b.added + b.deleted - (a.added + a.deleted) || a.name.localeCompare(b.name),
  );

  const modules: ModuleOwnership[] = [];
  for (const [module, byAuthor] of moduleTotals) {
    const shares = [...byAuthor.entries()]
      .filter(([, lines]) => lines > 0)
      .map(([author, lines]) => ({ author, lines }))
      .sort((a, b) => b.lines - a.lines || a.author.localeCompare(b.author));
    const total = shares.reduce((s, x) => s + x.lines, 0);
    if (total > 0) modules.push({ module, total, shares });
  }
  modules.sort((a, b) => b.total - a.total || a.module.localeCompare(b.module));
  modules.splice(MAX_MODULES);

  const hottest = [...rangeChanges.entries()]
    .sort((a, b) => b[1] - a[1] || (fileSet.get(b[0])?.lines ?? 0) - (fileSet.get(a[0])?.lines ?? 0) || a[0].localeCompare(b[0]))
    .slice(0, MAX_EXPERTS);
  const experts: FileExpert[] = [];
  for (const [path] of hottest) {
    // Satır değişimi yoksa (yalnızca yeniden adlandırma vb.) commit sayısına göre.
    const lines = fileLines.get(path);
    const weights = lines && [...lines.values()].some((n) => n > 0) ? lines : fileCommits.get(path);
    if (!weights) continue;
    const best = argmax(weights);
    const total = [...weights.values()].reduce((s, n) => s + n, 0);
    if (best === undefined || total === 0) continue;
    experts.push({ path, author: best, share: (weights.get(best) ?? 0) / total });
  }

  return { range, since, until: now, authors: authorStats, modules, weeks: weekStarts, rhythm, experts };
}
