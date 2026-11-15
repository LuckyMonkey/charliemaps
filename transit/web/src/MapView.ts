// The map canvas: draws the MBTA network on its real geometry (GTFS shapes) in the house style
// of the official MBTA map, and owns panning/zooming. Plain imperative code on purpose: React
// re-rendering thousands of SVG nodes per frame is what made the old map crawl on the 2012
// laptops; here one canvas redraws on requestAnimationFrame only when something changed.
import type { Basemap, Layer, Line, Network, Station } from './data';
import { layerOf } from './data';

export type View = { cx: number; cy: number; scale: number }; // world centre (m), px per metre
export type Vehicle = {
  id: string; label: string; route: string; dir: number | null; lat: number; lon: number;
  bearing: number | null; status: string; station: string | null; ts: number; x: number; y: number;
};
export type Hit = { kind: 'station'; station: Station } | { kind: 'line'; line: Line } | { kind: 'vehicle'; vehicle: Vehicle } | null;

type Callbacks = {
  onPick: (hit: Hit) => void;
  onHover: (hit: Hit, x: number, y: number) => void;
  onView: (view: View) => void;
};

const COLORS = {
  water: '#cfe4f1',
  land: '#fbfaf6',
  ink: '#1d1d1f',
  halo: 'rgba(251,250,246,0.94)',
  bus: '#FFC72C',
  busCase: '#c99700',
};
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MIN_SCALE = 0.0025;
const MAX_SCALE = 6;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private net: Network;
  private base: Basemap | null = null;
  private cb: Callbacks;
  private dpr = 1;
  private w = 0;
  private h = 0;
  view: View;
  private dirty = true;
  private raf = 0;
  layers = new Set<Layer>(['subway', 'rail', 'ferry', 'bus', 'live']);
  selectedLine: Line | null = null;
  selectedStation: Station | null = null;
  /** Stops of the branch shown in the panel: only these get names along a selected route. */
  labelStops: Set<number> | null = null;
  hover: Hit = null;
  big = false;
  vehicles: Vehicle[] = [];
  vehiclesLive = false;
  // caches
  private landPath: Path2D | null = null;
  private waterPath: Path2D | null = null;
  private linePaths = new Map<number, Path2D>();          // whole line (selection, hover)
  private chunks = new Map<number, Chunk[][]>();            // per line, per level of detail
  private busChunks: Chunk[][] = [[], [], []];
  private busFrequentChunks: Chunk[][] = [[], [], []];
  private landLod: (Path2D | null)[] = [null, null];
  private grid = new Map<string, number[]>();
  private readonly cell = 400;
  // gestures
  private pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { d: number; scale: number; mx: number; my: number } | null = null;
  private velocity: { vx: number; vy: number; t: number } = { vx: 0, vy: 0, t: 0 };
  private flight = 0;
  private resizeObs: ResizeObserver;
  private viewTimer = 0;

  constructor(canvas: HTMLCanvasElement, net: Network, cb: Callbacks, initial?: View) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot draw the map (no canvas).');
    this.ctx = ctx;
    this.net = net;
    this.cb = cb;
    for (const l of net.lines) {
      const p = new Path2D();
      for (const path of l.paths) addPolyline(p, path);
      this.linePaths.set(l.index, p);
      const levels = LOD_TOL.map(tol => l.paths.flatMap(path => chunkPath(tol ? simplify(path, tol) : path)));
      this.chunks.set(l.index, levels);
      if (l.mode === 'bus') levels.forEach((c, i) => (l.frequent ? this.busFrequentChunks : this.busChunks)[i].push(...c));
    }
    for (const s of net.stations) {
      const key = this.key(s.sx, s.sy);
      const list = this.grid.get(key);
      if (list) list.push(s.index); else this.grid.set(key, [s.index]);
    }
    this.view = initial ?? { cx: 0, cy: 0, scale: 0.04 };
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    if (!initial) this.fitCore(false);
    this.bind();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.flight);
    this.resizeObs.disconnect();
  }

  setBasemap(base: Basemap | null) {
    this.base = base;
    if (base) {
      this.landPath = new Path2D();
      for (const ring of base.land) addPolyline(this.landPath, ring, true);
      const coarse = new Path2D();
      for (const ring of base.land) addPolyline(coarse, simplify(ring, 90), true);
      this.landLod = [this.landPath, coarse];
      this.staticKey++;
      this.waterPath = new Path2D();
      for (const body of base.water) for (const ring of body) addPolyline(this.waterPath, ring, true);
    }
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.dirty) this.draw(); });
  }

  // ---- camera ---------------------------------------------------------------------------------
  private key(x: number, y: number) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }

  private clamp(v: View): View {
    const [x0, y0, x1, y1] = this.net.bounds;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale));
    const pad = 4000;
    return { scale, cx: Math.max(x0 - pad, Math.min(x1 + pad, v.cx)), cy: Math.max(y0 - pad, Math.min(y1 + pad, v.cy)) };
  }

  setView(v: View) {
    this.view = this.clamp(v);
    this.lastMove = performance.now();
    this.invalidate();
    clearTimeout(this.viewTimer);
    this.viewTimer = window.setTimeout(() => this.cb.onView(this.view), 250);
  }

  toWorld(px: number, py: number): [number, number] {
    return [this.view.cx + (px - this.w / 2) / this.view.scale, this.view.cy + (py - this.h / 2) / this.view.scale];
  }
  toScreen(x: number, y: number): [number, number] {
    return [(x - this.view.cx) * this.view.scale + this.w / 2, (y - this.view.cy) * this.view.scale + this.h / 2];
  }

  zoomAt(factor: number, px = this.w / 2, py = this.h / 2) {
    const [wx, wy] = this.toWorld(px, py);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.view.scale * factor));
    this.setView({ scale, cx: wx - (px - this.w / 2) / scale, cy: wy - (py - this.h / 2) / scale });
  }

  panBy(dx: number, dy: number) {
    this.setView({ ...this.view, cx: this.view.cx - dx / this.view.scale, cy: this.view.cy - dy / this.view.scale });
  }

  /** Fly (≤150 ms, house rule) or jump so the box fits, leaving room for the side panel. */
  fit(box: [number, number, number, number], animate = true, maxScale = 0.6) {
    const [x0, y0, x1, y1] = box;
    const panel = this.panelInset();
    const availW = Math.max(120, this.w - panel.left - panel.right - 48);
    const availH = Math.max(120, this.h - panel.top - panel.bottom - 48);
    const scale = Math.min(maxScale, availW / Math.max(1, x1 - x0), availH / Math.max(1, y1 - y0));
    // centre of the free area, in world units
    const offX = (panel.left - panel.right) / 2 / scale;
    const offY = (panel.top - panel.bottom) / 2 / scale;
    this.flyTo({ cx: (x0 + x1) / 2 - offX, cy: (y0 + y1) / 2 - offY, scale }, animate);
  }

  fitCore(animate = true) {
    // Downtown + the rapid transit network: what the canon map shows first.
    const rapid = this.net.lines.filter(l => l.mode === 'subway' || l.mode === 'mattapan');
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const l of rapid) {
      box[0] = Math.min(box[0], l.bbox[0]); box[1] = Math.min(box[1], l.bbox[1]);
      box[2] = Math.max(box[2], l.bbox[2]); box[3] = Math.max(box[3], l.bbox[3]);
    }
    this.fit(box, animate);
  }

  fitAll(animate = true) { this.fit(this.net.bounds as [number, number, number, number], animate); }

  flyTo(target: View, animate = true) {
    cancelAnimationFrame(this.flight);
    const to = this.clamp(target);
    if (!animate || reducedMotion()) { this.setView(to); return; }
    const from = { ...this.view };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 150);
      const e = 1 - (1 - t) ** 3;
      const ls = Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e;
      this.setView({ cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, scale: Math.exp(ls) });
      if (t < 1) this.flight = requestAnimationFrame(step);
    };
    this.flight = requestAnimationFrame(step);
  }

  /** How much of the canvas the floating panel covers (it lives in App's DOM). */
  private panelInset() {
    const panel = document.querySelector<HTMLElement>('.cm-panel');
    const out = { left: 0, right: 0, top: 0, bottom: 0 };
    if (!panel || panel.offsetParent === null) return out;
    const c = this.canvas.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    if (r.width < c.width * 0.6) out.left = Math.max(0, r.right - c.left);
    else out.bottom = Math.max(0, c.bottom - r.top);
    return out;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.invalidate();
  }

  // ---- input ----------------------------------------------------------------------------------
  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      cancelAnimationFrame(this.flight);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 1) {
        this.dragStart = { x: e.offsetX, y: e.offsetY, moved: false };
        this.velocity = { vx: 0, vy: 0, t: performance.now() };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.view.scale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        if (this.dragStart) this.dragStart.moved = true;
      }
    });
    c.addEventListener('pointermove', e => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') this.hoverAt(e.offsetX, e.offsetY);
        return;
      }
      const cur = { x: e.offsetX, y: e.offsetY };
      this.pointers.set(e.pointerId, cur);
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.panBy(mx - this.pinch.mx, my - this.pinch.my);
        this.zoomAt((this.pinch.scale * d / this.pinch.d) / this.view.scale, mx, my);
        this.pinch.mx = mx; this.pinch.my = my;
        return;
      }
      if (!this.dragStart) return;
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (!this.dragStart.moved && Math.hypot(cur.x - this.dragStart.x, cur.y - this.dragStart.y) > 4) {
        this.dragStart.moved = true;
        c.classList.add('dragging');
        this.setHover(null, 0, 0);
      }
      if (this.dragStart.moved) {
        this.panBy(dx, dy);
        const now = performance.now();
        const dt = Math.max(1, now - this.velocity.t);
        this.velocity = { vx: 0.8 * (dx / dt) + 0.2 * this.velocity.vx, vy: 0.8 * (dy / dt) + 0.2 * this.velocity.vy, t: now };
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size > 0) return;
      c.classList.remove('dragging');
      const start = this.dragStart;
      this.dragStart = null;
      if (start && !start.moved && e.type === 'pointerup') {
        this.cb.onPick(this.hitTest(e.offsetX, e.offsetY, e.pointerType === 'touch' ? 18 : 10));
      } else if (start?.moved && performance.now() - this.velocity.t < 60) {
        this.glide();
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.pointers.size) this.setHover(null, 0, 0); });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      cancelAnimationFrame(this.flight);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
      const dy = Math.max(-240, Math.min(240, e.deltaY * unit));
      // Like every web map: the wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms
      // around the pointer; dragging pans.
      this.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022)), e.offsetX, e.offsetY);
    }, { passive: false });
    c.addEventListener('dblclick', e => { e.preventDefault(); this.zoomAt(2, e.offsetX, e.offsetY); });
    c.addEventListener('keydown', e => {
      const step = e.shiftKey ? 240 : 80;
      const k = e.key;
      if (k === 'ArrowLeft') this.panBy(step, 0);
      else if (k === 'ArrowRight') this.panBy(-step, 0);
      else if (k === 'ArrowUp') this.panBy(0, step);
      else if (k === 'ArrowDown') this.panBy(0, -step);
      else if (k === '+' || k === '=') this.zoomAt(1.5);
      else if (k === '-' || k === '_') this.zoomAt(1 / 1.5);
      else if (k === '0') this.fitCore();
      else return;
      e.preventDefault();
    });
  }

  private glide() {
    if (reducedMotion()) return;
    let { vx, vy } = this.velocity;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last; last = now;
      this.panBy(vx * dt, vy * dt);
      const k = Math.pow(0.992, dt);
      vx *= k; vy *= k;
      if (Math.hypot(vx, vy) > 0.02) this.flight = requestAnimationFrame(step);
    };
    if (Math.hypot(vx, vy) > 0.15) this.flight = requestAnimationFrame(step);
  }

  private hoverPending = false;
  private hoverAt(x: number, y: number) {
    if (this.hoverPending) return;
    this.hoverPending = true;
    requestAnimationFrame(() => {
      this.hoverPending = false;
      this.setHover(this.hitTest(x, y, 8), x, y);
    });
  }

  private setHover(hit: Hit, x: number, y: number) {
    const same = hitKey(hit) === hitKey(this.hover);
    this.hover = hit;
    this.canvas.style.cursor = hit ? 'pointer' : '';
    this.cb.onHover(hit, x, y);
    if (!same) this.invalidate();
  }

  // ---- level of detail ---------------------------------------------------------------------------
  private lineVisible(l: Line) { return this.layers.has(layerOf(l.mode)); }
  private stationMinScale(s: Station): number {
    if (s.rank === 0) return 0;          // subway: always
    if (s.rank === 1) return 0.03;       // Silver Line
    if (s.rank === 2) return 0.006;      // Commuter Rail
    if (s.rank === 3) return 0.012;      // ferry
    return 0.22;                         // bus stops: street level
  }
  private stationVisible(s: Station) {
    if (s.rank === 4 && !this.layers.has('bus')) return false;
    const onLayer = s.lines.some(li => this.lineVisible(this.net.lines[li]));
    if (!onLayer) return false;
    if (this.selectedLine?.stationSet.has(s.index)) return true;
    return this.view.scale >= this.stationMinScale(s);
  }

  hitTest(px: number, py: number, radius: number): Hit {
    // vehicles first (they sit on top)
    if (this.layers.has('live')) {
      let best: Vehicle | null = null, bd = radius * radius;
      for (const v of this.vehicles) {
        if (!this.vehicleVisible(v)) continue;
        const [sx, sy] = this.toScreen(v.x, v.y);
        const d = (sx - px) ** 2 + (sy - py) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
      if (best) return { kind: 'vehicle', vehicle: best };
    }
    const [wx, wy] = this.toWorld(px, py);
    const r = (radius + 4) / this.view.scale;
    let bestS: Station | null = null, bestD = Infinity;
    for (let gx = Math.floor((wx - r) / this.cell); gx <= Math.floor((wx + r) / this.cell); gx++) {
      for (let gy = Math.floor((wy - r) / this.cell); gy <= Math.floor((wy + r) / this.cell); gy++) {
        for (const i of this.grid.get(`${gx},${gy}`) ?? []) {
          const s = this.net.stations[i];
          if (!this.stationVisible(s)) continue;
          const d = Math.hypot(s.sx - wx, s.sy - wy) * this.view.scale - (s.rank <= 2 ? 3 : 0);
          // prefer more important stations when close
          const score = d + s.rank * 1.5;
          if (d <= radius + 2 && score < bestD) { bestD = score; bestS = s; }
        }
      }
    }
    if (bestS) return { kind: 'station', station: bestS };
    // lines: nearest visible segment, rapid transit wins ties
    const tol = radius / this.view.scale;
    let bestL: Line | null = null, bl = Infinity;
    for (const l of this.net.lines) {
      if (!this.lineVisible(l)) continue;
      const [x0, y0, x1, y1] = l.bbox;
      if (wx < x0 - tol || wx > x1 + tol || wy < y0 - tol || wy > y1 + tol) continue;
      const weight = l.mode === 'bus' ? 1.6 : l.mode === 'rail' ? 1.15 : 1;
      for (const p of l.paths) {
        for (let i = 0; i + 3 < p.length; i += 2) {
          const ax = p[i], ay = p[i + 1], dx = p[i + 2] - ax, dy = p[i + 3] - ay;
          if ((wx < Math.min(ax, ax + dx) - tol) || (wx > Math.max(ax, ax + dx) + tol)) continue;
          if ((wy < Math.min(ay, ay + dy) - tol) || (wy > Math.max(ay, ay + dy) + tol)) continue;
          const den = dx * dx + dy * dy;
          const t = den ? Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / den)) : 0;
          const d = Math.hypot(ax + t * dx - wx, ay + t * dy - wy) * weight;
          if (d < bl) { bl = d; bestL = l; }
        }
      }
    }
    return bestL && bl <= tol * 1.6 ? { kind: 'line', line: bestL } : null;
  }

  private vehicleVisible(v: Vehicle) {
    const line = this.net.lineById.get(v.route);
    if (!line) return false;
    if (this.selectedLine) return this.selectedLine === line;
    if (!this.lineVisible(line)) return false;
    return line.mode !== 'bus' || this.view.scale >= 0.03;
  }

  private width(px: number) { return (this.big ? px * 1.35 : px) / this.view.scale; }

  // ---- drawing -------------------------------------------------------------------------------
  // Two layers. The static layer (land, water, every route) is drawn into an offscreen bitmap a
  // bit larger than the screen; panning slides that bitmap and zooming scales it, so a drag costs
  // one drawImage. It is redrawn sharp when the camera rests or leaves the bitmap. Stations,
  // labels, vehicles and the hover highlight are drawn on top every frame (they are cheap).
  private cache: { canvas: HTMLCanvasElement; box: [number, number, number, number]; scale: number; key: string } | null = null;
  private staticKey = 0;
  private lastMove = 0;
  private settleTimer = 0;

  /** Call when anything in the static layer changes (layers, selection, basemap, big type). */
  invalidateStatic() { this.staticKey++; this.invalidate(); }

  draw() {
    this.dirty = false;
    const { ctx, dpr, view } = this;
    const key = `${this.staticKey}|${this.w}x${this.h}|${dpr}`;
    const c = this.cache;
    const covered = !!c && (() => {
      const [x0, y0, x1, y1] = this.viewportBox(0);
      return x0 >= c.box[0] && y0 >= c.box[1] && x1 <= c.box[2] && y1 <= c.box[3];
    })();
    const ratio = c ? view.scale / c.scale : 1;
    const sharp = !!c && c.key === key && covered && Math.abs(Math.log(ratio)) < 0.01;
    const moving = performance.now() - this.lastMove < 160;
    const usable = !!c && c.key === key && ratio > 0.3 && ratio < 3.5;
    if (!sharp && !(moving && usable)) this.renderStatic(key);
    else if (!sharp) {
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.invalidate(), 170);
    }
    const cache = this.cache as NonNullable<MapView['cache']>;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.base ? COLORS.water : COLORS.land;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const [sx, sy] = this.toScreen(cache.box[0], cache.box[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cache.canvas, sx * dpr, sy * dpr, (cache.box[2] - cache.box[0]) * view.scale * dpr, (cache.box[3] - cache.box[1]) * view.scale * dpr);

    const s = view.scale;
    const z = Math.log2(s / 0.01);
    const lod = s < 0.012 ? 2 : s < 0.06 ? 1 : 0;
    this.vp = this.viewportBox(12);
    // Hovered line, full strength on top.
    const hoverLine = this.hover?.kind === 'line' ? this.hover.line : null;
    if (hoverLine && hoverLine !== this.selectedLine) {
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - view.cx * s), dpr * (this.h / 2 - view.cy * s));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      this.strokeHighlight(hoverLine, z, lod);
    }
    // Screen-space from here on: stations, vehicles, labels keep their pixel size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawStations(z);
    if (this.layers.has('live')) this.drawVehicles(z);
  }

  private renderStatic(key: string) {
    const margin = Math.round(Math.max(this.w, this.h) * 0.35);
    const cw = this.w + margin * 2, ch = this.h + margin * 2;
    const canvas = this.cache?.canvas ?? document.createElement('canvas');
    canvas.width = Math.round(cw * this.dpr);
    canvas.height = Math.round(ch * this.dpr);
    const cctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    const saved = { ctx: this.ctx, w: this.w, h: this.h };
    this.ctx = cctx; this.w = cw; this.h = ch; // same centre, bigger frame
    try { this.drawStatic(); } finally { this.ctx = saved.ctx; this.w = saved.w; this.h = saved.h; }
    const v = this.view;
    this.cache = { canvas, key, scale: v.scale, box: [v.cx - cw / 2 / v.scale, v.cy - ch / 2 / v.scale, v.cx + cw / 2 / v.scale, v.cy + ch / 2 / v.scale] };
  }

  private drawStatic() {
    const { ctx, dpr, view } = this;
    const s = view.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.base ? COLORS.water : COLORS.land;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - view.cx * s), dpr * (this.h / 2 - view.cy * s));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lod = s < 0.012 ? 2 : s < 0.06 ? 1 : 0;
    this.vp = this.viewportBox(12);
    if (this.landPath) {
      ctx.fillStyle = COLORS.land;
      ctx.fill((lod === 2 ? this.landLod[1] : this.landPath) as Path2D, 'evenodd');
      ctx.fillStyle = COLORS.water;
      if (this.waterPath) ctx.fill(this.waterPath, 'nonzero');
    }

    const sel = this.selectedLine;
    const z = Math.log2(s / 0.01); // 0 at region view, ~2 at the core, ~6 at street level
    const lerp = (a: number, b: number, from: number, to: number) => a + (b - a) * Math.max(0, Math.min(1, (z - from) / (to - from)));
    ctx.globalAlpha = sel ? 0.22 : 1;

    // Bus network: thin canon yellow, frequent routes a little bolder.
    if (this.layers.has('bus')) {
      const wBus = lerp(0.7, 2.6, 0, 6);
      if (z > 2.5) {
        ctx.strokeStyle = COLORS.busCase;
        ctx.lineWidth = this.width(wBus + 1.2);
        this.strokeChunks(this.busChunks[lod]);
        ctx.lineWidth = this.width(wBus * 1.5 + 1.2);
        this.strokeChunks(this.busFrequentChunks[lod]);
      }
      ctx.strokeStyle = COLORS.bus;
      ctx.lineWidth = this.width(wBus);
      this.strokeChunks(this.busChunks[lod]);
      ctx.lineWidth = this.width(wBus * 1.5);
      this.strokeChunks(this.busFrequentChunks[lod]);
    }
    // Ferries: dashed teal.
    if (this.layers.has('ferry')) {
      ctx.setLineDash([this.width(6), this.width(5)]);
      for (const l of this.net.lines) if (l.mode === 'ferry') this.strokeLine(l, lerp(1.4, 3, 0, 5), lod);
      ctx.setLineDash([]);
    }
    // Commuter Rail: canon purple.
    if (this.layers.has('rail')) {
      const wr = lerp(2, 5.5, 0, 5);
      for (const l of this.net.lines) if (l.mode === 'rail') this.strokeLine(l, wr, lod);
    }
    // Rapid transit on top, each with a thin land-coloured casing so parallel lines stay legible.
    if (this.layers.has('subway')) {
      const wSub = lerp(3.2, 8.5, 0, 5);
      const casing = Math.max(1.2, wSub * 0.28);
      ctx.strokeStyle = COLORS.land;
      for (const l of this.net.lines) {
        if (l.mode !== 'subway' && l.mode !== 'silver' && l.mode !== 'mattapan') continue;
        ctx.lineWidth = this.width(this.subwayWidth(l, wSub) + casing * 2);
        this.strokeChunks((this.chunks.get(l.index) as Chunk[][])[lod]);
      }
      for (const l of this.net.lines) if (l.mode === 'silver') this.strokeLine(l, this.subwayWidth(l, wSub), lod);
      for (const l of this.net.lines) if (l.mode === 'mattapan' || l.mode === 'subway') this.strokeLine(l, this.subwayWidth(l, wSub), lod);
    }
    ctx.globalAlpha = 1;
    if (sel) this.strokeHighlight(sel, z, lod);
  }

  private strokeHighlight(l: Line, z: number, lod: number) {
    const ctx = this.ctx;
    const lerp = (a: number, b: number, from: number, to: number) => a + (b - a) * Math.max(0, Math.min(1, (z - from) / (to - from)));
    const wl = l.mode === 'bus' ? lerp(2.2, 5, 0, 6) : this.subwayWidth(l, lerp(3.6, 9, 0, 5));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = this.width(wl + 4);
    this.strokeChunks((this.chunks.get(l.index) as Chunk[][])[lod]);
    if (l.mode === 'ferry') ctx.setLineDash([this.width(6), this.width(5)]);
    this.strokeLine(l, wl, lod);
    ctx.setLineDash([]);
  }

  private subwayWidth(l: Line, w: number) {
    if (l.mode === 'mattapan') return w * 0.62;
    if (l.mode === 'silver') return w * 0.72;
    return w;
  }

  private strokeLine(l: Line, px: number, lod: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = this.width(px);
    this.strokeChunks((this.chunks.get(l.index) as Chunk[][])[lod]);
  }

  /** Stroke only the pieces of a route that cross the screen. */
  private vp: [number, number, number, number] = [0, 0, 0, 0];
  private strokeChunks(list: Chunk[]) {
    const [x0, y0, x1, y1] = this.vp;
    for (const c of list) {
      if (c.x1 < x0 || c.x0 > x1 || c.y1 < y0 || c.y0 > y1) continue;
      this.ctx.stroke(c.path);
    }
  }

  private viewportBox(marginPx: number): [number, number, number, number] {
    const [a, b] = this.toWorld(-marginPx, -marginPx);
    const [c, d] = this.toWorld(this.w + marginPx, this.h + marginPx);
    return [a, b, c, d];
  }

  private drawStations(z: number) {
    const ctx = this.ctx;
    const big = this.big ? 1.3 : 1;
    const sel = this.selectedLine;
    const [wx0, wy0] = this.toWorld(-40, -40);
    const [wx1, wy1] = this.toWorld(this.w + 40, this.h + 40);
    const visible: Station[] = [];
    // Grid scan only while zoomed in; otherwise the station list is short enough.
    if (this.view.scale >= 0.05) {
      for (let gx = Math.floor(wx0 / this.cell); gx <= Math.floor(wx1 / this.cell); gx++) {
        for (let gy = Math.floor(wy0 / this.cell); gy <= Math.floor(wy1 / this.cell); gy++) {
          for (const i of this.grid.get(`${gx},${gy}`) ?? []) {
            const st = this.net.stations[i];
            if (this.stationVisible(st)) visible.push(st);
          }
        }
      }
    } else {
      for (const st of this.net.stations) {
        if (st.rank === 4) continue;
        if (st.sx < wx0 || st.sx > wx1 || st.sy < wy0 || st.sy > wy1) continue;
        if (this.stationVisible(st)) visible.push(st);
      }
    }
    // Painter's order: bus stops, then CR, then subway, then transfers.
    visible.sort((a, b) => b.rank - a.rank || Number(a.transfer) - Number(b.transfer));
    const dimmed = (st: Station) => !!sel && !sel.stationSet.has(st.index);

    for (const st of visible) {
      const [x, y] = this.toScreen(st.sx, st.sy);
      ctx.globalAlpha = dimmed(st) ? 0.3 : 1;
      if (st.rank === 4) {
        const r = Math.min(4.2, 1.6 + (z - 4.5) * 0.9) * big;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.lineWidth = 1.3; ctx.strokeStyle = COLORS.busCase; ctx.stroke();
        continue;
      }
      const r = (st.transfer ? 4.2 + z * 0.75 : st.rank === 0 ? 2.6 + z * 0.55 : 2 + z * 0.45) * big;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, r), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = st.transfer ? 2.4 : 1.7;
      ctx.strokeStyle = st.transfer || st.rank === 0 ? COLORS.ink : st.rank === 2 ? '#80276C' : st.rank === 3 ? '#008EAA' : '#5b6670';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Selection / hover rings
    for (const [st, color] of [[this.selectedStation, '#1d1d1f'], [this.hover?.kind === 'station' ? this.hover.station : null, '#2bb59c']] as const) {
      if (!st) continue;
      const [x, y] = this.toScreen(st.sx, st.sy);
      ctx.beginPath(); ctx.arc(x, y, 11 * big, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
    }

    this.drawLabels(visible, z);
  }

  private drawLabels(visible: Station[], z: number) {
    const ctx = this.ctx;
    const big = this.big ? 1.3 : 1;
    const sel = this.selectedLine;
    const placed: number[][] = [];
    const collides = (b: number[]) => {
      for (const p of placed) if (b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]) return true;
      return false;
    };
    // Station dots are obstacles too, so names never sit on another station.
    for (const st of visible) {
      if (st.rank === 4 && z < 6) continue;
      const [x, y] = this.toScreen(st.sx, st.sy);
      placed.push([x - 3, y - 3, x + 3, y + 3]);
    }
    const onBranch = (st: Station) => !!sel && sel.stationSet.has(st.index) && (!this.labelStops || this.labelStops.has(st.index));
    const labelMin = (st: Station) => {
      if (onBranch(st)) return -9;
      if (st.rank === 0) return st.transfer ? 0.6 : 1.2;
      if (st.rank === 1) return 2.4;
      if (st.rank === 2) return st.transfer ? 0.6 : 1.6;
      if (st.rank === 3) return 2.6;
      return 6.4;
    };
    const ordered = visible
      .filter(st => z >= labelMin(st))
      .sort((a, b) => {
        const sa = onBranch(a) ? -1 : 0, sb = onBranch(b) ? -1 : 0;
        return sa - sb || Number(b.transfer) - Number(a.transfer) || a.rank - b.rank;
      });
    if (this.selectedStation && !ordered.includes(this.selectedStation)) ordered.unshift(this.selectedStation);
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let count = 0;
    for (const st of ordered) {
      if (count > 420) break;
      const [x, y] = this.toScreen(st.sx, st.sy);
      if (x < -100 || y < -30 || x > this.w + 100 || y > this.h + 30) continue;
      const strong = st.transfer || st === this.selectedStation;
      const size = (st.rank === 4 ? 11 : strong ? 13.5 : st.rank === 0 ? 12.5 : 11.5) * big;
      ctx.font = `${strong ? 700 : st.rank === 4 ? 500 : 600} ${size}px ${FONT}`;
      const name = st.name;
      const tw = ctx.measureText(name).width;
      const gap = (st.transfer ? 10 : 7) * big;
      const cands: [number, number, CanvasTextAlign][] = [
        [x + gap, y, 'left'], [x - gap, y, 'right'], [x, y - gap - size * 0.55, 'center'], [x, y + gap + size * 0.55, 'center'],
      ];
      for (const [lx, ly, align] of cands) {
        const left = align === 'left' ? lx : align === 'right' ? lx - tw : lx - tw / 2;
        const box = [left - 2, ly - size * 0.62, left + tw + 2, ly + size * 0.62];
        if (collides(box)) continue;
        placed.push(box);
        ctx.textAlign = align;
        ctx.globalAlpha = sel && !sel.stationSet.has(st.index) ? 0.45 : 1;
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = COLORS.halo;
        ctx.strokeText(name, lx, ly);
        ctx.fillStyle = st.rank === 4 ? '#4a4a4f' : COLORS.ink;
        ctx.fillText(name, lx, ly);
        count++;
        break;
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawVehicles(z: number) {
    const ctx = this.ctx;
    const big = this.big ? 1.25 : 1;
    const stale = !this.vehiclesLive;
    for (const v of this.vehicles) {
      if (!this.vehicleVisible(v)) continue;
      const line = this.net.lineById.get(v.route) as Line;
      const [x, y] = this.toScreen(v.x, v.y);
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) continue;
      const bus = line.mode === 'bus';
      const r = (bus ? 3.4 + Math.max(0, z - 3) * 0.6 : 5 + Math.max(0, z - 2) * 0.5) * big;
      ctx.globalAlpha = stale ? 0.35 : 1;
      if (v.bearing !== null) {
        const a = (v.bearing - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
        ctx.lineTo(x + Math.cos(a + 2.2) * r, y + Math.sin(a + 2.2) * r);
        ctx.lineTo(x + Math.cos(a - 2.2) * r, y + Math.sin(a - 2.2) * r);
        ctx.closePath();
        ctx.fillStyle = COLORS.ink; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = bus ? COLORS.bus : line.color; ctx.fill();
      ctx.lineWidth = 1.8; ctx.strokeStyle = bus ? COLORS.ink : '#ffffff'; ctx.stroke();
      if (this.hover?.kind === 'vehicle' && this.hover.vehicle.id === v.id) {
        ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#2bb59c'; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

type Chunk = { path: Path2D; x0: number; y0: number; x1: number; y1: number };
/** Simplification tolerance (m) per level of detail: street, city, region. */
const LOD_TOL = [0, 12, 60];

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

function simplify(pts: Float32Array, tol: number): Float32Array {
  const n = pts.length / 2;
  if (n < 3) return pts;
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

function addPolyline(p: Path2D, pts: Float32Array, close = false) {
  if (pts.length < 4) return;
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  if (close) p.closePath();
}

function hitKey(h: Hit) {
  if (!h) return '';
  return h.kind === 'station' ? `s${h.station.index}` : h.kind === 'line' ? `l${h.line.index}` : `v${h.vehicle.id}`;
}
