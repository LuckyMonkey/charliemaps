// The map canvas: the MBTA network on its real geometry (GTFS shapes), styled after the official
// MBTA map, with panning and zooming. Two layers:
//  - static (land, water, every route): painted off the main thread by a Web Worker on an
//    OffscreenCanvas (staticWorker.ts), handed back as a bitmap a bit larger than the screen.
//    Panning slides that bitmap and zooming scales it, so a drag is one drawImage; a sharp copy
//    is requested when the camera rests or leaves the bitmap. Old browsers paint it here instead.
//  - overlay, every frame: selection veil + highlighted line, the itinerary, A/B pins, stations,
//    labels (placement reused while moving), vehicles, hover.
import type { Basemap, Layer, Line, Network, Station } from './data';
import { layerOf } from './data';
import { COLORS, StaticPainter, simplify, subwayWidth, type Geometry, type PaintParams } from './staticLayer';

export type View = { cx: number; cy: number; scale: number }; // world centre (m), px per metre
export type Vehicle = {
  id: string; label: string; route: string; dir: number | null; lat: number; lon: number;
  bearing: number | null; status: string; station: string | null; ts: number; x: number; y: number;
};
export type Hit = { kind: 'station'; station: Station } | { kind: 'line'; line: Line } | { kind: 'vehicle'; vehicle: Vehicle } | null;
/** A ride or walk drawn on the map: points in world metres. */
export type Trace = { color: string; walk: boolean; pts: Float32Array };
export type Pin = { label: 'A' | 'B'; x: number; y: number };

type Callbacks = {
  onPick: (hit: Hit) => void;
  onHover: (hit: Hit, x: number, y: number) => void;
  onView: (view: View) => void;
};

const INK = '#1d1d1f';
const HALO = 'rgba(251,250,246,0.94)';
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MIN_SCALE = 0.0025;
const MAX_SCALE = 6;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

type Cache = { image: CanvasImageSource; box: [number, number, number, number]; scale: number; key: string };

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private net: Network;
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
  labelStops: Set<number> | null = null;
  traces: Trace[] = [];
  pins: Pin[] = [];
  hover: Hit = null;
  big = false;
  vehicles: Vehicle[] = [];
  vehiclesLive = false;
  hasBase = false;
  private linePaths = new Map<number, Path2D[]>();
  private grid = new Map<string, number[]>();
  private readonly cell = 400;
  private worker: Worker | null = null;
  private workerReady = false;
  private painter: StaticPainter | null = null;
  private geometry: Geometry;
  private cache: Cache | null = null;
  private inFlight: { id: number; key: string } | null = null;
  private wanted = false;
  private paintId = 0;
  private staticKey = 0;
  private lastMove = 0;
  private settleTimer = 0;
  private textWidth = new Map<string, number>();
  private lastLabels: { st: Station; dx: number; dy: number; align: CanvasTextAlign; font: string }[] = [];
  private lastLabelScale = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { d: number; scale: number; mx: number; my: number } | null = null;
  private velocity = { vx: 0, vy: 0, t: 0 };
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
      this.linePaths.set(l.index, [0, 12, 60].map(tol => {
        const p = new Path2D();
        for (const path of l.paths) addPolyline(p, simplify(path, tol));
        return p;
      }));
    }
    for (const s of net.stations) {
      const key = this.key(s.sx, s.sy);
      const list = this.grid.get(key);
      if (list) list.push(s.index); else this.grid.set(key, [s.index]);
    }
    this.geometry = { lines: net.lines.map(l => ({ index: l.index, mode: l.mode, color: l.color, frequent: l.frequent, paths: l.paths })), land: [], water: [] };
    this.startWorker();
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
    this.worker?.terminate();
  }

  private startWorker() {
    try {
      if (typeof OffscreenCanvas === 'undefined' || !('transferToImageBitmap' in OffscreenCanvas.prototype)) throw new Error('no OffscreenCanvas');
      const w = new Worker(new URL('./staticWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => this.onWorker(e.data);
      w.onerror = () => this.fallback();
      w.postMessage({ type: 'init', geometry: this.geometry });
      this.worker = w;
    } catch {
      this.fallback();
    }
  }

  private fallback() {
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.inFlight = null;
    this.painter = new StaticPainter(this.geometry);
    this.invalidate();
  }

  private onWorker(msg: { type: string; params?: PaintParams; bitmap?: ImageBitmap }) {
    if (msg.type === 'ready') { this.workerReady = true; this.invalidate(); return; }
    if (msg.type === 'error') { this.fallback(); return; }
    if (msg.type !== 'painted' || !msg.bitmap || !msg.params) return;
    const key = this.inFlight?.key ?? '';
    this.inFlight = null;
    const p = msg.params;
    const old = this.cache?.image;
    this.cache = { image: msg.bitmap, scale: p.scale, key, box: [p.cx - p.w / 2 / p.scale, p.cy - p.h / 2 / p.scale, p.cx + p.w / 2 / p.scale, p.cy + p.h / 2 / p.scale] };
    if (old && typeof ImageBitmap !== 'undefined' && old instanceof ImageBitmap) old.close();
    this.invalidate();
  }

  setBasemap(base: Basemap | null) {
    this.hasBase = !!base;
    this.geometry = { ...this.geometry, land: base?.land ?? [], water: base?.water ?? [] };
    if (this.worker) { this.workerReady = false; this.inFlight = null; this.worker.postMessage({ type: 'init', geometry: this.geometry }); }
    else this.painter = new StaticPainter(this.geometry);
    this.invalidateStatic();
  }

  invalidate() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.dirty) this.draw(); });
  }
  /** Layers or type size changed: the static bitmap must be repainted. */
  invalidateStatic() { this.staticKey++; this.invalidate(); }

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

  fit(box: [number, number, number, number], animate = true, maxScale = 0.6) {
    const [x0, y0, x1, y1] = box;
    const panel = this.panelInset();
    const availW = Math.max(120, this.w - panel.left - panel.right - 48);
    const availH = Math.max(120, this.h - panel.top - panel.bottom - 48);
    const scale = Math.min(maxScale, availW / Math.max(1, x1 - x0), availH / Math.max(1, y1 - y0));
    const offX = (panel.left - panel.right) / 2 / scale;
    const offY = (panel.top - panel.bottom) / 2 / scale;
    this.flyTo({ cx: (x0 + x1) / 2 - offX, cy: (y0 + y1) / 2 - offY, scale }, animate);
  }

  fitCore(animate = true) {
    const rapid = this.net.lines.filter(l => l.mode === 'subway' || l.mode === 'mattapan');
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const l of rapid) {
      box[0] = Math.min(box[0], l.bbox[0]); box[1] = Math.min(box[1], l.bbox[1]);
      box[2] = Math.max(box[2], l.bbox[2]); box[3] = Math.max(box[3], l.bbox[3]);
    }
    this.fit(box, animate);
  }

  fitAll(animate = true) { this.fit(this.net.bounds as [number, number, number, number], animate); }

  flyTo(target: View, animate = true, ms = 220) {
    cancelAnimationFrame(this.flight);
    const to = this.clamp(target);
    if (!animate || reducedMotion()) { this.setView(to); return; }
    const from = { ...this.view };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - t) ** 3;
      const ls = Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e;
      this.setView({ cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, scale: Math.exp(ls) });
      if (t < 1) this.flight = requestAnimationFrame(step);
    };
    this.flight = requestAnimationFrame(step);
  }

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
      if (performance.now() - this.lastMove < 120) return; // no hit tests while the map moves
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

  /** Where a station is on screen right now (for the map -> line diagram morph). */
  screenOf(st: Station): [number, number] { return this.toScreen(st.sx, st.sy); }

  // ---- level of detail ---------------------------------------------------------------------------
  private lineVisible(l: Line) { return this.layers.has(layerOf(l.mode)); }
  private stationMinScale(s: Station): number {
    if (s.rank === 0) return 0;
    if (s.rank === 1) return 0.03;
    if (s.rank === 2) return 0.006;
    if (s.rank === 3) return 0.012;
    return 0.22;
  }
  private stationVisible(s: Station) {
    if (s.rank === 4 && !this.layers.has('bus')) return false;
    if (!s.lines.some(li => this.lineVisible(this.net.lines[li]))) return false;
    if (this.selectedLine?.stationSet.has(s.index)) return true;
    return this.view.scale >= this.stationMinScale(s);
  }

  hitTest(px: number, py: number, radius: number): Hit {
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
          const score = d + s.rank * 1.5;
          if (d <= radius + 2 && score < bestD) { bestD = score; bestS = s; }
        }
      }
    }
    if (bestS) return { kind: 'station', station: bestS };
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

  // ---- drawing -----------------------------------------------------------------------------------
  private staticParams(): PaintParams {
    const margin = Math.round(Math.max(this.w, this.h) * 0.35);
    return {
      cx: this.view.cx, cy: this.view.cy, scale: this.view.scale, w: this.w + margin * 2, h: this.h + margin * 2,
      // the static bitmap is at most 1.5x: retina screens get a lighter layer, the overlay stays crisp
      dpr: Math.min(this.dpr, 1.5), layers: [...this.layers], big: this.big, base: this.hasBase,
    };
  }

  private requestStatic(key: string) {
    if (this.worker) {
      if (!this.workerReady) return;
      if (this.inFlight) { this.wanted = true; return; }
      this.inFlight = { id: ++this.paintId, key };
      this.worker.postMessage({ type: 'paint', id: this.paintId, params: this.staticParams() });
      return;
    }
    if (!this.painter) return;
    const p = this.staticParams();
    const canvas = this.cache?.image instanceof HTMLCanvasElement ? this.cache.image : document.createElement('canvas');
    canvas.width = Math.round(p.w * p.dpr); canvas.height = Math.round(p.h * p.dpr);
    this.painter.paint(canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D, p);
    this.cache = { image: canvas, key, scale: p.scale, box: [p.cx - p.w / 2 / p.scale, p.cy - p.h / 2 / p.scale, p.cx + p.w / 2 / p.scale, p.cy + p.h / 2 / p.scale] };
  }

  draw() {
    this.dirty = false;
    const { ctx, dpr, view } = this;
    const key = `${this.staticKey}|${this.w}x${this.h}|${dpr}`;
    const c = this.cache;
    const vb = this.viewportBox(0);
    const covered = !!c && vb[0] >= c.box[0] && vb[1] >= c.box[1] && vb[2] <= c.box[2] && vb[3] <= c.box[3];
    const ratio = c ? view.scale / c.scale : 1;
    const sharp = !!c && c.key === key && covered && Math.abs(Math.log(ratio)) < 0.01;
    const moving = performance.now() - this.lastMove < 160;
    if (!sharp) {
      const usable = !!c && c.key === key && ratio > 0.3 && ratio < 3.5;
      if (!moving || !usable || !covered) this.requestStatic(key);
      else this.wanted = true;
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.invalidate(), 180);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.hasBase ? COLORS.water : COLORS.land;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (c) {
      const [sx, sy] = this.toScreen(c.box[0], c.box[1]);
      ctx.drawImage(c.image, sx * dpr, sy * dpr, (c.box[2] - c.box[0]) * view.scale * dpr, (c.box[3] - c.box[1]) * view.scale * dpr);
    }

    const s = view.scale;
    const z = Math.log2(s / 0.01);
    const lod = s < 0.012 ? 2 : s < 0.06 ? 1 : 0;
    const lerp = (a: number, b: number, from: number, to: number) => a + (b - a) * Math.max(0, Math.min(1, (z - from) / (to - from)));
    if (this.selectedLine || this.traces.length) {
      ctx.fillStyle = 'rgba(251,250,246,0.74)'; // the veil: everything else steps back
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - view.cx * s), dpr * (this.h / 2 - view.cy * s));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const wpx = (px: number) => (this.big ? px * 1.35 : px) / s;
    for (const l of [this.selectedLine, this.hover?.kind === 'line' ? this.hover.line : null]) {
      if (!l) continue;
      const wl = l.mode === 'bus' ? lerp(2.2, 5, 0, 6) : subwayWidth(l.mode, lerp(3.6, 9, 0, 5));
      const path = (this.linePaths.get(l.index) as Path2D[])[lod];
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = wpx(wl + 4); ctx.stroke(path);
      ctx.strokeStyle = l.color; ctx.lineWidth = wpx(wl); ctx.stroke(path);
    }
    for (const t of this.traces) {
      const p = new Path2D();
      addPolyline(p, t.pts);
      ctx.setLineDash(t.walk ? [wpx(2), wpx(7)] : []);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = wpx(t.walk ? 6 : 12); ctx.stroke(p);
      ctx.strokeStyle = t.walk ? INK : t.color; ctx.lineWidth = wpx(t.walk ? 3.5 : 8); ctx.stroke(p);
    }
    ctx.setLineDash([]);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawStations(z, moving);
    if (this.layers.has('live')) this.drawVehicles(z);
    this.drawPins();
    if (this.wanted && !this.inFlight && !moving) { this.wanted = false; this.requestStatic(key); }
  }

  private viewportBox(marginPx: number): [number, number, number, number] {
    const [a, b] = this.toWorld(-marginPx, -marginPx);
    const [c, d] = this.toWorld(this.w + marginPx, this.h + marginPx);
    return [a, b, c, d];
  }

  private drawStations(z: number, moving: boolean) {
    const ctx = this.ctx;
    const big = this.big ? 1.3 : 1;
    const sel = this.selectedLine;
    const [wx0, wy0, wx1, wy1] = this.viewportBox(40);
    const visible: Station[] = [];
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
    visible.sort((a, b) => b.rank - a.rank || Number(a.transfer) - Number(b.transfer));
    const dim = (st: Station) => (!!sel && !sel.stationSet.has(st.index)) || (!sel && this.traces.length > 0);
    for (const st of visible) {
      const [x, y] = this.toScreen(st.sx, st.sy);
      ctx.globalAlpha = dim(st) ? 0.3 : 1;
      if (st.rank === 4) {
        const r = Math.min(4.2, 1.6 + (z - 4.5) * 0.9) * big;
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, r), 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.lineWidth = 1.3; ctx.strokeStyle = COLORS.busCase; ctx.stroke();
        continue;
      }
      const r = (st.transfer ? 4.2 + z * 0.75 : st.rank === 0 ? 2.6 + z * 0.55 : 2 + z * 0.45) * big;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, r), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = st.transfer ? 2.4 : 1.7;
      ctx.strokeStyle = st.transfer || st.rank === 0 ? INK : st.rank === 2 ? '#80276C' : st.rank === 3 ? '#008EAA' : '#5b6670';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const [st, color] of [[this.selectedStation, INK], [this.hover?.kind === 'station' ? this.hover.station : null, '#2bb59c']] as const) {
      if (!st) continue;
      const [x, y] = this.toScreen(st.sx, st.sy);
      ctx.beginPath(); ctx.arc(x, y, 11 * big, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
    }
    // While the camera pans at the same zoom, reuse the last label placement (no collision work).
    if (moving && this.lastLabelScale === this.view.scale && this.lastLabels.length) this.redrawLabels();
    else this.placeLabels(visible, z);
  }

  private measure(font: string, text: string) {
    const k = font + '|' + text;
    let w = this.textWidth.get(k);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      if (this.textWidth.size > 20000) this.textWidth.clear();
      this.textWidth.set(k, w);
    }
    return w;
  }

  private paintLabel(st: Station, lx: number, ly: number, align: CanvasTextAlign, font: string) {
    const ctx = this.ctx;
    const sel = this.selectedLine;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.globalAlpha = (sel && !sel.stationSet.has(st.index)) || (!sel && this.traces.length) ? 0.45 : 1;
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = HALO;
    ctx.strokeText(st.name, lx, ly);
    ctx.fillStyle = st.rank === 4 ? '#4a4a4f' : INK;
    ctx.fillText(st.name, lx, ly);
  }

  private redrawLabels() {
    const ctx = this.ctx;
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const l of this.lastLabels) {
      const [x, y] = this.toScreen(l.st.sx, l.st.sy);
      this.paintLabel(l.st, x + l.dx, y + l.dy, l.align, l.font);
    }
    ctx.globalAlpha = 1;
  }

  private placeLabels(visible: Station[], z: number) {
    const ctx = this.ctx;
    const big = this.big ? 1.3 : 1;
    const sel = this.selectedLine;
    const placed: number[][] = [];
    const collides = (b: number[]) => {
      for (const p of placed) if (b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]) return true;
      return false;
    };
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
    const ordered = visible.filter(st => z >= labelMin(st)).sort((a, b) =>
      Number(onBranch(b)) - Number(onBranch(a)) || Number(b.transfer) - Number(a.transfer) || a.rank - b.rank);
    if (this.selectedStation && !ordered.includes(this.selectedStation)) ordered.unshift(this.selectedStation);
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const out: MapView['lastLabels'] = [];
    for (const st of ordered) {
      if (out.length > 420) break;
      const [x, y] = this.toScreen(st.sx, st.sy);
      if (x < -100 || y < -30 || x > this.w + 100 || y > this.h + 30) continue;
      const strong = st.transfer || st === this.selectedStation;
      const size = (st.rank === 4 ? 11 : strong ? 13.5 : st.rank === 0 ? 12.5 : 11.5) * big;
      const font = `${strong ? 700 : st.rank === 4 ? 500 : 600} ${size}px ${FONT}`;
      const tw = this.measure(font, st.name);
      const gap = (st.transfer ? 10 : 7) * big;
      const cands: [number, number, CanvasTextAlign][] = [
        [gap, 0, 'left'], [-gap, 0, 'right'], [0, -gap - size * 0.55, 'center'], [0, gap + size * 0.55, 'center'],
      ];
      for (const [dx, dy, align] of cands) {
        const lx = x + dx, ly = y + dy;
        const left = align === 'left' ? lx : align === 'right' ? lx - tw : lx - tw / 2;
        const box = [left - 2, ly - size * 0.62, left + tw + 2, ly + size * 0.62];
        if (collides(box)) continue;
        placed.push(box);
        this.paintLabel(st, lx, ly, align, font);
        out.push({ st, dx, dy, align, font });
        break;
      }
    }
    ctx.globalAlpha = 1;
    this.lastLabels = out;
    this.lastLabelScale = this.view.scale;
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
        ctx.fillStyle = INK; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = bus ? COLORS.bus : line.color; ctx.fill();
      ctx.lineWidth = 1.8; ctx.strokeStyle = bus ? INK : '#ffffff'; ctx.stroke();
      if (this.hover?.kind === 'vehicle' && this.hover.vehicle.id === v.id) {
        ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#2bb59c'; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPins() {
    const ctx = this.ctx;
    for (const p of this.pins) {
      const [x, y] = this.toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 14, y - 16, x - 14, y - 34, x, y - 34);
      ctx.bezierCurveTo(x + 14, y - 34, x + 14, y - 16, x, y);
      ctx.fillStyle = p.label === 'A' ? '#1e8f7a' : INK;
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 13px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.label, x, y - 23);
    }
  }
}

function addPolyline(p: Path2D, pts: Float32Array) {
  if (pts.length < 4) return;
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
}

function hitKey(h: Hit) {
  if (!h) return '';
  return h.kind === 'station' ? `s${h.station.index}` : h.kind === 'line' ? `l${h.line.index}` : `v${h.vehicle.id}`;
}

/** The piece of a line's track between two points (for drawing an itinerary leg on its real shape). */
export function sliceTrack(line: Line, ax: number, ay: number, bx: number, by: number): Float32Array | null {
  let best: { d: number; path: Float32Array; i: number; j: number } | null = null;
  for (const p of line.paths) {
    let ia = 0, ib = 0, da = Infinity, db = Infinity;
    for (let k = 0; k < p.length; k += 2) {
      const d1 = (p[k] - ax) ** 2 + (p[k + 1] - ay) ** 2;
      const d2 = (p[k] - bx) ** 2 + (p[k + 1] - by) ** 2;
      if (d1 < da) { da = d1; ia = k; }
      if (d2 < db) { db = d2; ib = k; }
    }
    const d = Math.sqrt(da) + Math.sqrt(db);
    if (!best || d < best.d) best = { d, path: p, i: ia, j: ib };
  }
  if (!best || best.d > 1200) return null;
  const { path, i, j } = best;
  if (i <= j) return path.slice(i, j + 2);
  const out = new Float32Array(i - j + 2);
  for (let k = i, o = 0; k >= j; k -= 2, o += 2) { out[o] = path[k]; out[o + 1] = path[k + 1]; }
  return out;
}
