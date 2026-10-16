// Commit graph'ının şerit (lane) yerleşimi. SAF: node/DOM import'u yok, webview de kullanabilir.
import type { CommitSummary, GraphEdge, GraphLayout, GraphRow } from '../types';

const COLORS = 5;

/** Bir şeritte aynı parent'a doğru ilerleyen kenar demeti. */
interface Lane {
  /** Beklenen parent hash'i. */
  waiting: string;
  color: number;
  /** Bu şeritte birlikte ilerleyen kenarlar (son noktaları hep bu şeritte). */
  edges: GraphEdge[];
}

type Point = GraphEdge['points'][number];

function lastPoint(edge: GraphEdge): Point {
  const p = edge.points[edge.points.length - 1];
  if (!p) throw new Error('boş kenar');
  return p;
}

/** Şeritte ilerleyen kenarı (row, lane) noktasına bağlar; sözleşmeye uygun ara noktaları ekler. */
function extendTo(edge: GraphEdge, fromLane: number, row: number, lane: number): void {
  const last = lastPoint(edge);
  if (last.row === row) {
    // Kenar bu satıra çapraz olarak yeni geldi: doğrudan hedef şeride yönlendir.
    last.lane = lane;
    return;
  }
  if (fromLane !== lane && last.row < row - 1) edge.points.push({ row: row - 1, lane: fromLane });
  edge.points.push({ row, lane });
}

export function layoutGraph(commits: CommitSummary[]): GraphLayout {
  const rows: GraphRow[] = [];
  const edges: GraphEdge[] = [];
  const lanes: (Lane | null)[] = [];
  let nextColor = 0;
  let maxLane = -1;

  const freeLane = (exclude: number): number => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null && i !== exclude) return i;
    return Math.max(lanes.length, exclude + 1);
  };
  // Yeni şerit ömrü için sıradaki renk; mümkünse o an etkin şeritlerin renkleriyle çakışmaz.
  const newColor = (): number => {
    const used = new Set<number>();
    for (const lane of lanes) if (lane) used.add(lane.color);
    let c = nextColor;
    for (let k = 0; k < COLORS && used.has(c); k++) c = (c + 1) % COLORS;
    if (used.has(c)) c = nextColor;
    nextColor = (c + 1) % COLORS;
    return c;
  };

  for (let r = 0; r < commits.length; r++) {
    const commit = commits[r]!;

    // 1) Bu commit'i bekleyen şeritler; commit en soldakine oturur.
    const waitingLanes: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i]?.waiting === commit.hash) waitingLanes.push(i);

    let myLane: number;
    let color: number;
    if (waitingLanes.length > 0) {
      myLane = waitingLanes[0]!;
      color = lanes[myLane]!.color;
    } else {
      myLane = freeLane(-1);
      color = newColor();
    }

    // 2) Bekleyen kenarları bu satırda commit'e bağla; diğer şeritler serbest kalır.
    for (const i of waitingLanes) {
      for (const edge of lanes[i]!.edges) extendTo(edge, i, r, myLane);
      lanes[i] = null;
    }

    rows.push({ hash: commit.hash, lane: myLane, color, isMerge: commit.parents.length > 1 });
    if (myLane > maxLane) maxLane = myLane;

    // 3) İlk parent commit'in şeridinde beklenir.
    const [first, ...others] = commit.parents;
    if (first !== undefined) {
      const edge: GraphEdge = { color, points: [{ row: r, lane: myLane }] };
      edges.push(edge);
      while (lanes.length <= myLane) lanes.push(null);
      lanes[myLane] = { waiting: first, color, edges: [edge] };
    }

    // 4) Merge'ün diğer parent'ları: bekleyen şerit varsa ona katıl, yoksa yeni şerit aç.
    for (const parent of others) {
      let target = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (i !== myLane && lanes[i]?.waiting === parent) {
          target = i;
          break;
        }
      }
      if (target === -1) {
        target = freeLane(myLane);
        while (lanes.length <= target) lanes.push(null);
        lanes[target] = { waiting: parent, color: newColor(), edges: [] };
      }
      const lane = lanes[target]!;
      const edge: GraphEdge = {
        color: lane.color,
        points: [
          { row: r, lane: myLane },
          { row: r + 1, lane: target },
        ],
      };
      edges.push(edge);
      lane.edges.push(edge);
      if (target > maxLane) maxLane = target;
    }
  }

  // 5) Parent'ı yüklenmemiş kenarlar alt kenara uzar.
  const bottom = commits.length;
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    if (!lane) continue;
    for (const edge of lane.edges) {
      const last = lastPoint(edge);
      if (last.row === bottom) last.lane = i;
      else edge.points.push({ row: bottom, lane: i });
    }
  }

  return { rows, edges, laneCount: maxLane + 1 };
}
