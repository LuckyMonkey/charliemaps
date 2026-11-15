// Render worker: paints the static layer on an OffscreenCanvas and hands back an ImageBitmap,
// so the main thread never stalls while a sharp frame is drawn (the 2012 laptops).
import { StaticPainter, type Geometry, type PaintParams } from './staticLayer';

let painter: StaticPainter | null = null;
let canvas: OffscreenCanvas | null = null;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: 'init'; geometry: Geometry } | { type: 'paint'; id: number; params: PaintParams };
  try {
    if (msg.type === 'init') {
      painter = new StaticPainter(msg.geometry);
      (self as unknown as Worker).postMessage({ type: 'ready' });
      return;
    }
    if (!painter) return;
    const p = msg.params;
    const w = Math.max(1, Math.round(p.w * p.dpr)), h = Math.max(1, Math.round(p.h * p.dpr));
    if (!canvas) canvas = new OffscreenCanvas(w, h);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
    painter.paint(ctx, p);
    const bitmap = canvas.transferToImageBitmap();
    (self as unknown as Worker).postMessage({ type: 'painted', id: msg.id, params: p, bitmap }, [bitmap]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
