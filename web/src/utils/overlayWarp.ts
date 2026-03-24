import type { LatLngBounds, Point } from "leaflet";
import type { OverlayPoint, OverlayProject } from "../types/models";

export function buildDefaultOverlayPoints(bounds: LatLngBounds, rows: number, cols: number): OverlayPoint[] {
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  const points: OverlayPoint[] = [];

  for (let row = 0; row < rows; row += 1) {
    const y = row / (rows - 1);
    const lat = north + (south - north) * y;
    for (let col = 0; col < cols; col += 1) {
      const x = col / (cols - 1);
      const lng = west + (east - west) * x;
      points.push({ lat, lng });
    }
  }

  return points;
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  src: [Point, Point, Point],
  dest: [Point, Point, Point]
) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dest;
  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (!denom) return;

  const m11 = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
  const m12 = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
  const m21 = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
  const m22 = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
  const dx =
    (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) /
    denom;
  const dy =
    (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) /
    denom;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m11, m12, m21, m22, dx, dy);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

export function drawWarpedOverlay(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  project: OverlayProject,
  points: Point[]
) {
  const { rows, cols, image_width: width, image_height: height } = project;
  ctx.save();
  ctx.globalAlpha = project.opacity;

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const i = row * cols + col;
      const p00 = points[i];
      const p10 = points[i + 1];
      const p01 = points[i + cols];
      const p11 = points[i + cols + 1];
      const sx0 = (col / (cols - 1)) * width;
      const sx1 = ((col + 1) / (cols - 1)) * width;
      const sy0 = (row / (rows - 1)) * height;
      const sy1 = ((row + 1) / (rows - 1)) * height;

      drawTriangle(ctx, image, [{ x: sx0, y: sy0 } as Point, { x: sx1, y: sy0 } as Point, { x: sx1, y: sy1 } as Point], [
        p00,
        p10,
        p11
      ]);
      drawTriangle(ctx, image, [{ x: sx0, y: sy0 } as Point, { x: sx1, y: sy1 } as Point, { x: sx0, y: sy1 } as Point], [
        p00,
        p11,
        p01
      ]);
    }
  }

  ctx.restore();
}

export function drawOverlayGrid(ctx: CanvasRenderingContext2D, project: OverlayProject, points: Point[]) {
  ctx.save();
  ctx.strokeStyle = "rgba(8, 66, 79, 0.85)";
  ctx.lineWidth = 1;
  for (let row = 0; row < project.rows; row += 1) {
    ctx.beginPath();
    for (let col = 0; col < project.cols; col += 1) {
      const point = points[row * project.cols + col];
      if (col === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  for (let col = 0; col < project.cols; col += 1) {
    ctx.beginPath();
    for (let row = 0; row < project.rows; row += 1) {
      const point = points[row * project.cols + col];
      if (row === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
