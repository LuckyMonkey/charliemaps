// The static map layer: land, water and every route, drawn for one camera. Shared by the render
// worker (OffscreenCanvas, off the main thread) and the main-thread fallback. No DOM here.

export type GeoLine = { index: number; mode: string; color: string; frequent: boolean; paths: Float32Array[] };
export type Geometry = { lines: GeoLine[]; land: Float32Array[]; water: Float32Array[][] };
export type PaintParams = {
  cx: number; cy: number; scale: number; w: number; h: number; dpr: number;
  layers: string[]; big: boolean; base: boolean;
};

type Chunk = { path: Path2D; x0: number; y0: number; x1: number; y1: number };
/** Simplification tolerance (m) per level of detail: street, city, region. */
const LOD_TOL = [0, 12, 60];
export const COLORS = { water: '#cfe4f1', land: '#fbfaf6', bus: '#FFC72C', busCase: '#c99700' };
const layerOf = (mode: string) => (mode === 'bus' ? 'bus' : mode === 'rail' ? 'rail' : mode === 'ferry' ? 'ferry' : 'subway');

export function simplify(pts: Float32Array, tol: number): Float32Array {
  const n = pts.length / 2;
  if (n < 3 || tol <= 0) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop() as number, a = stack.pop() as number;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], dx = pts[b * 2] - ax, dy = pts[b * 2 + 1] - ay;
    const den = dx * dx + dy * dy;
    let worst = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2], py = pts[i * 2 + 1];
      const t = den ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / den)) : 0;
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > worst) { worst = d; idx = i; }
    }
    if (worst > tol2) { keep[idx] = 1; stack.push(a, idx, idx, b); }
  }
  let m = 0;
  for (let i = 0; i < n; i++) if (keep[i]) m++;
  const out = new Float32Array(m * 2);
  for (let i = 0, j = 0; i < n; i++) if (keep[i]) { out[j++] = pts[i * 2]; out[j++] = pts[i * 2 + 1]; }
  return out;
}

function chunkPath(pts: Float32Array): Chunk[] {
  const out: Chunk[] = [];
  const n = pts.length / 2;
  const STEP = 40;
  for (let start = 0; start < n - 1; start += STEP) {
    const end = Math.min(n - 1, start + STEP);
    const path = new Path2D();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = start; i <= end; i++) {
      const x = pts[i * 2], y = pts[i * 2 + 1];
      if (i === start) path.moveTo(x, y); else path.lineTo(x, y);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    out.push({ path, x0, y0, x1, y1 });
  }
  return out;
}

function ring(p: Path2D, pts: Float32Array) {
  if (pts.length < 6) return;
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  p.closePath();
}

export class StaticPainter {
  private lines: (GeoLine & { chunks: Chunk[][] })[];
  private bus: Chunk[][] = [[], [], []];
  private busFrequent: Chunk[][] = [[], [], []];
  private land: [Path2D, Path2D] | null = null;
  private water: Path2D | null = null;
  private vp: [number, number, number, number] = [0, 0, 0, 0];
  private ctx!: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private scale = 1;
  private big = false;

  constructor(g: Geometry) {
    this.lines = g.lines.map(l => {
      const chunks = LOD_TOL.map(tol => l.paths.flatMap(p => chunkPath(simplify(p, tol))));
      if (l.mode === 'bus') chunks.forEach((c, i) => (l.frequent ? this.busFrequent : this.bus)[i].push(...c));
      return { ...l, chunks };
    });
    if (g.land.length) {
      const fine = new Path2D(), coarse = new Path2D();
      for (const r of g.land) { ring(fine, r); ring(coarse, simplify(r, 90)); }
      this.land = [fine, coarse];
      this.water = new Path2D();
      for (const body of g.water) for (const r of body) ring(this.water, r);
    }
  }

  private width(px: number) { return (this.big ? px * 1.35 : px) / this.scale; }

  private stroke(list: Chunk[]) {
    const [x0, y0, x1, y1] = this.vp;
    for (const c of list) {
      if (c.x1 < x0 || c.x0 > x1 || c.y1 < y0 || c.y0 > y1) continue;
      this.ctx.stroke(c.path);
    }
  }

  paint(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, p: PaintParams) {
    this.ctx = ctx;
    this.scale = p.scale;
    this.big = p.big;
    const s = p.scale, dpr = p.dpr;
    const layers = new Set(p.layers);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = p.base && this.land ? COLORS.water : COLORS.land;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (p.w / 2 - p.cx * s), dpr * (p.h / 2 - p.cy * s));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pad = 12 / s;
    this.vp = [p.cx - p.w / 2 / s - pad, p.cy - p.h / 2 / s - pad, p.cx + p.w / 2 / s + pad, p.cy + p.h / 2 / s + pad];
    const lod = s < 0.012 ? 2 : s < 0.06 ? 1 : 0;
    if (p.base && this.land) {
      ctx.fillStyle = COLORS.land;
      ctx.fill(lod === 2 ? this.land[1] : this.land[0], 'evenodd');
      ctx.fillStyle = COLORS.water;
      if (this.water) ctx.fill(this.water, 'nonzero');
    }
    const z = Math.log2(s / 0.01);
    const lerp = (a: number, b: number, from: number, to: number) => a + (b - a) * Math.max(0, Math.min(1, (z - from) / (to - from)));

    if (layers.has('bus')) {
      const wBus = lerp(0.7, 2.6, 0, 6);
      if (z > 2.5) {
        ctx.strokeStyle = COLORS.busCase;
        ctx.lineWidth = this.width(wBus + 1.2); this.stroke(this.bus[lod]);
        ctx.lineWidth = this.width(wBus * 1.5 + 1.2); this.stroke(this.busFrequent[lod]);
      }
      ctx.strokeStyle = COLORS.bus;
      ctx.lineWidth = this.width(wBus); this.stroke(this.bus[lod]);
      ctx.lineWidth = this.width(wBus * 1.5); this.stroke(this.busFrequent[lod]);
    }
    if (layers.has('ferry')) {
      ctx.setLineDash([this.width(6), this.width(5)]);
      for (const l of this.lines) if (l.mode === 'ferry') this.line(l, lerp(1.4, 3, 0, 5), lod);
      ctx.setLineDash([]);
    }
    if (layers.has('rail')) {
      const wr = lerp(2, 5.5, 0, 5);
      for (const l of this.lines) if (l.mode === 'rail') this.line(l, wr, lod);
    }
    if (layers.has('subway')) {
      const wSub = lerp(3.2, 8.5, 0, 5);
      const casing = Math.max(1.2, wSub * 0.28);
      ctx.strokeStyle = COLORS.land;
      for (const l of this.lines) {
        if (layerOf(l.mode) !== 'subway') continue;
        ctx.lineWidth = this.width(subwayWidth(l.mode, wSub) + casing * 2);
        this.stroke(l.chunks[lod]);
      }
      for (const l of this.lines) if (l.mode === 'silver') this.line(l, subwayWidth(l.mode, wSub), lod);
      for (const l of this.lines) if (l.mode === 'mattapan' || l.mode === 'subway') this.line(l, subwayWidth(l.mode, wSub), lod);
    }
  }

  private line(l: GeoLine & { chunks: Chunk[][] }, px: number, lod: number) {
    this.ctx.strokeStyle = l.color;
    this.ctx.lineWidth = this.width(px);
    this.stroke(l.chunks[lod]);
  }
}

export function subwayWidth(mode: string, w: number) {
  if (mode === 'mattapan') return w * 0.62;
  if (mode === 'silver') return w * 0.72;
  return w;
}
