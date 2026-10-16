// Zaman makinesi verisi. SAF: node/DOM import'u yok, webview de kullanabilir.
import type { FileStat, GitRef, RepoSnapshot, TimelineData, TimelineEvent, TimelineMark } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TAGS = 20;
const MAX_MERGES = 8;

export function buildTimeline(snapshot: RepoSnapshot, files: FileStat[], refs?: GitRef[]): TimelineData {
  const paths = files.map((f) => f.path);
  const index = new Map(paths.map((p, i) => [p, i]));
  const firstSeen: number[] = paths.map(() => Number.POSITIVE_INFINITY);

  // Eski ad → bugünkü ad; commit'ler yeniden eskiye gezilir (aggregate.ts ile aynı kural).
  const alias = new Map<string, string>();
  const events: TimelineEvent[] = [];
  for (const commit of snapshot.commits) {
    const touched = new Set<number>();
    for (const change of commit.files) {
      const target = alias.get(change.path) ?? change.path;
      if (change.oldPath !== undefined && change.oldPath !== change.path) alias.set(change.oldPath, target);
      const i = index.get(target);
      if (i === undefined) continue;
      touched.add(i);
      if (commit.date < firstSeen[i]!) firstSeen[i] = commit.date;
    }
    events.push({
      date: commit.date,
      hash: commit.hash,
      message: commit.message,
      author: commit.author,
      files: [...touched].sort((a, b) => a - b),
    });
  }
  // Yazar tarihleri topolojik sırayla tam örtüşmeyebilir; ikili arama için tarihe göre sırala.
  events.reverse();
  events.sort((a, b) => a.date - b.date);

  const start = events[0]?.date ?? 0;
  const end = events[events.length - 1]?.date ?? 0;
  // Geçmişte hiç görünmeyen dosya (ör. geçmiş kesik) baştan beri var sayılır.
  for (let i = 0; i < firstSeen.length; i++) if (!Number.isFinite(firstSeen[i]!)) firstSeen[i] = start;

  return { start, end, paths, firstSeen, events, marks: buildMarks(snapshot, events, refs) };
}

function buildMarks(snapshot: RepoSnapshot, events: TimelineEvent[], refs?: GitRef[]): TimelineMark[] {
  const marks: TimelineMark[] = [];
  const first = events[0];
  if (first) marks.push({ date: first.date, label: `İlk commit: ${first.message}`, kind: 'first' });

  const byHash = new Map(snapshot.commits.map((c) => [c.hash, c]));
  const tags = (refs ?? [])
    .filter((r) => r.kind === 'tag' && byHash.has(r.hash))
    .map((r) => ({ date: byHash.get(r.hash)!.date, label: r.name, kind: 'tag' as const }))
    .sort((a, b) => b.date - a.date)
    .slice(0, MAX_TAGS);

  if (tags.length > 0) {
    marks.push(...tags);
  } else {
    const merges = snapshot.commits
      .filter((c) => c.parents.length > 1)
      .sort((a, b) => b.date - a.date)
      .slice(0, MAX_MERGES);
    for (const m of merges) marks.push({ date: m.date, label: m.message, kind: 'merge' });
  }
  return marks.sort((a, b) => a.date - b.date);
}

export interface TimelineFrame {
  /** Pencere içinde dosya başına değişiklik (commit) sayısı. */
  changes: Map<string, number>;
  /** O tarihte henüz var olmayan dosyalar. */
  missing: Set<string>;
  /** Penceredeki commit sayısı. */
  windowCommits: number;
}

/** date > x koşulunu sağlayan ilk event'in indeksi. */
function upperBound(events: TimelineEvent[], x: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.date <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `at` anındaki görünüm: (at − windowDays, at] aralığındaki değişimler. */
export function timelineFrame(t: TimelineData, at: number, windowDays = 7): TimelineFrame {
  const from = upperBound(t.events, at - windowDays * DAY_MS);
  const to = upperBound(t.events, at);
  const counts = new Map<number, number>();
  for (let e = from; e < to; e++) {
    for (const i of t.events[e]!.files) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const changes = new Map<string, number>();
  for (const [i, n] of counts) changes.set(t.paths[i]!, n);

  const missing = new Set<string>();
  for (let i = 0; i < t.paths.length; i++) if (t.firstSeen[i]! > at) missing.add(t.paths[i]!);

  return { changes, missing, windowCommits: Math.max(0, to - from) };
}

/** Kaydırıcı adımları (ms): ≤120 gün günlük, ≤3 yıl haftalık, üstü aylık. Son adım = end. */
export function timelineSteps(t: TimelineData): number[] {
  const span = t.end - t.start;
  if (span <= 0) return [t.end];

  const steps: number[] = [];
  if (span <= 3 * 365 * DAY_MS) {
    const step = span <= 120 * DAY_MS ? DAY_MS : 7 * DAY_MS;
    for (let x = t.start; x < t.end; x += step) steps.push(x);
  } else {
    const d = new Date(t.start);
    const day = d.getDate();
    for (let k = 0; ; k++) {
      const x = new Date(d.getFullYear(), d.getMonth() + k, 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
      // Ayın günü yoksa (31 → Şubat) ayın son gününe kırp.
      const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
      x.setDate(Math.min(day, last));
      const ms = x.getTime();
      if (ms >= t.end) break;
      steps.push(ms);
    }
  }
  steps.push(t.end);
  return steps;
}
