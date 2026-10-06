/**
 * A minimum cut of a pixel grid (docs/photo/selections.md, Quick Selection): Boykov and Kolmogorov's max-flow
 * (PAMI 2004), with Kolmogorov's timestamp and distance heuristics, on a four-connected grid. Each pixel is joined
 * to the source (what it costs to call it background) and the sink (what it costs to call it foreground) and to its
 * neighbours (what it costs to cut between them); the cut labels each pixel. Pure; tested against every labelling of
 * small grids.
 */

/** Directions to a neighbour: right, down, left, up (opposite is +2 mod 4). */
const opposite = (d: number) => (d + 2) & 3;

const FREE = 0;
const SOURCE = 1;
const SINK = 2;
/** Parent links: a terminal, or none (an orphan, or free). Otherwise 0..3, the way to the parent. */
const TERMINAL = 4;
const NONE = 5;

export class GridCut {
  readonly size: number;
  /** Residual capacity to the source (positive) or from the sink (negative). */
  private readonly terminal: Float64Array;
  /** Residual capacity of the edge from a pixel toward each neighbour, four a pixel. */
  private readonly cap: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.size = width * height;
    this.terminal = new Float64Array(this.size);
    this.cap = new Float32Array(this.size * 4);
  }

  /** What labelling pixel `i` background costs (`toSource`) and what labelling it foreground costs (`toSink`). */
  setTerminals(i: number, toSource: number, toSink: number) {
    this.terminal[i] = toSource - toSink;
  }

  /** The cost of a cut between pixel `i` and its neighbour to the right (`down`: below), both ways. */
  setEdge(i: number, down: boolean, weight: number) {
    const j = down ? i + this.width : i + 1;
    const d = down ? 1 : 0;
    this.cap[i * 4 + d] = weight;
    this.cap[j * 4 + opposite(d)] = weight;
  }

  private neighbour(i: number, d: number): number {
    const x = i % this.width;
    switch (d) {
      case 0:
        return x + 1 < this.width ? i + 1 : -1;
      case 1:
        return i + this.width < this.size ? i + this.width : -1;
      case 2:
        return x > 0 ? i - 1 : -1;
      default:
        return i >= this.width ? i - this.width : -1;
    }
  }

  /** Solves the cut: 1 for each pixel on the source's side (foreground), 0 on the sink's. */
  solve(): Uint8Array {
    const { size, terminal, cap } = this;
    const tree = new Uint8Array(size);
    const parent = new Uint8Array(size).fill(NONE);
    const stamp = new Int32Array(size);
    const dist = new Int32Array(size);
    const queued = new Uint8Array(size);
    let active = new Int32Array(Math.max(16, size));
    let head = 0;
    let tail = 0;
    let count = 0;
    const push = (i: number) => {
      if (queued[i]) return;
      if (count === active.length) {
        const grown = new Int32Array(active.length * 2);
        for (let k = 0; k < count; k++) grown[k] = active[(head + k) % active.length];
        active = grown;
        head = 0;
        tail = count;
      }
      active[tail] = i;
      tail = (tail + 1) % active.length;
      count++;
      queued[i] = 1;
    };
    const shift = () => {
      const i = active[head];
      head = (head + 1) % active.length;
      count--;
      queued[i] = 0;
      return i;
    };
    for (let i = 0; i < size; i++) {
      if (terminal[i] > 0) tree[i] = SOURCE;
      else if (terminal[i] < 0) tree[i] = SINK;
      else continue;
      parent[i] = TERMINAL;
      dist[i] = 1;
      push(i);
    }
    let time = 0;
    const orphans: number[] = [];
    for (;;) {
      // Grow the trees until they touch: the edge from `a` (source's tree) toward `b` (sink's) along `dir`.
      let a = -1;
      let b = -1;
      let dir = -1;
      while (count > 0 && a < 0) {
        const p = active[head];
        if (tree[p] === FREE) {
          shift();
          continue;
        }
        const t = tree[p];
        for (let d = 0; d < 4; d++) {
          const q = this.neighbour(p, d);
          if (q < 0) continue;
          // The source's tree grows along p → q; the sink's along q → p.
          const open = t === SOURCE ? cap[p * 4 + d] > 0 : cap[q * 4 + opposite(d)] > 0;
          if (!open) continue;
          if (tree[q] === FREE) {
            tree[q] = t;
            parent[q] = opposite(d);
            stamp[q] = stamp[p];
            dist[q] = dist[p] + 1;
            push(q);
          } else if (tree[q] !== t) {
            if (t === SOURCE) [a, b, dir] = [p, q, d];
            else [a, b, dir] = [q, p, opposite(d)];
            break;
          } else if (stamp[q] <= stamp[p] && dist[q] > dist[p]) {
            parent[q] = opposite(d);
            stamp[q] = stamp[p];
            dist[q] = dist[p] + 1;
          }
        }
        if (a < 0) shift();
      }
      if (a < 0) break;
      time++;
      // The bottleneck along source → … → a → b → … → sink.
      let delta = cap[a * 4 + dir];
      let x = a;
      while (parent[x] !== TERMINAL) {
        const up = this.neighbour(x, parent[x]);
        delta = Math.min(delta, cap[up * 4 + opposite(parent[x])]);
        x = up;
      }
      delta = Math.min(delta, terminal[x]);
      x = b;
      while (parent[x] !== TERMINAL) {
        delta = Math.min(delta, cap[x * 4 + parent[x]]);
        x = this.neighbour(x, parent[x]);
      }
      delta = Math.min(delta, -terminal[x]);
      // Push it, and orphan whatever's cut off by a saturated link.
      cap[a * 4 + dir] -= delta;
      cap[b * 4 + opposite(dir)] += delta;
      for (x = a; ; ) {
        if (parent[x] === TERMINAL) {
          terminal[x] -= delta;
          if (terminal[x] <= 0) {
            terminal[x] = 0;
            parent[x] = NONE;
            orphans.push(x);
          }
          break;
        }
        const up = this.neighbour(x, parent[x]);
        const e = up * 4 + opposite(parent[x]);
        cap[e] -= delta;
        cap[x * 4 + parent[x]] += delta;
        if (cap[e] <= 0) {
          cap[e] = 0;
          parent[x] = NONE;
          orphans.push(x);
        }
        x = up;
      }
      for (x = b; ; ) {
        if (parent[x] === TERMINAL) {
          terminal[x] += delta;
          if (terminal[x] >= 0) {
            terminal[x] = 0;
            parent[x] = NONE;
            orphans.push(x);
          }
          break;
        }
        const up = this.neighbour(x, parent[x]);
        const e = x * 4 + parent[x];
        cap[e] -= delta;
        cap[up * 4 + opposite(parent[x])] += delta;
        if (cap[e] <= 0) {
          cap[e] = 0;
          parent[x] = NONE;
          orphans.push(x);
        }
        x = up;
      }
      // Adopt the orphans: a new parent in the same tree still rooted at its terminal, else free.
      while (orphans.length) {
        const p = orphans.pop()!;
        const t = tree[p];
        let best = NONE;
        let bestDist = Infinity;
        for (let d = 0; d < 4; d++) {
          const q = this.neighbour(p, d);
          if (q < 0 || tree[q] !== t || parent[q] === NONE) continue;
          const open = t === SOURCE ? cap[q * 4 + opposite(d)] > 0 : cap[p * 4 + d] > 0;
          if (!open) continue;
          // Is q rooted at a terminal? Walk up until a pixel known this round, a terminal, or an orphan.
          let k = 0;
          let y = q;
          let rooted = false;
          for (;;) {
            if (stamp[y] === time) {
              k += dist[y];
              rooted = true;
              break;
            }
            k++;
            if (parent[y] === TERMINAL) {
              stamp[y] = time;
              dist[y] = 1;
              rooted = true;
              break;
            }
            if (parent[y] === NONE) break;
            y = this.neighbour(y, parent[y]);
          }
          if (!rooted) continue;
          if (k < bestDist) {
            best = d;
            bestDist = k;
          }
          // The path walked is known now.
          for (let z = q, n = k; stamp[z] !== time; z = this.neighbour(z, parent[z])) {
            stamp[z] = time;
            dist[z] = n--;
          }
        }
        if (best !== NONE) {
          parent[p] = best;
          stamp[p] = time;
          dist[p] = bestDist + 1;
          continue;
        }
        // No parent: p is free, its neighbours that could grow into it wake, and its children are orphans.
        for (let d = 0; d < 4; d++) {
          const q = this.neighbour(p, d);
          if (q < 0 || tree[q] !== t) continue;
          const open = t === SOURCE ? cap[q * 4 + opposite(d)] > 0 : cap[p * 4 + d] > 0;
          if (open) push(q);
          if (parent[q] !== TERMINAL && parent[q] !== NONE && this.neighbour(q, parent[q]) === p) {
            parent[q] = NONE;
            orphans.push(q);
          }
        }
        tree[p] = FREE;
        parent[p] = NONE;
      }
    }
    const labels = new Uint8Array(size);
    for (let i = 0; i < size; i++) labels[i] = tree[i] === SOURCE ? 1 : 0;
    return labels;
  }
}
