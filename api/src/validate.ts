import { validate as validateUuid } from "uuid";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function parseBbox(input: unknown) {
  const raw = String(input ?? "");
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    throw new HttpError(400, "bbox must be minLng,minLat,maxLng,maxLat");
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) {
    throw new HttpError(400, "bbox bounds are invalid");
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function parseNear(query: Record<string, unknown>) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  const radiusM = Number(query.radius_m ?? 500);

  if ([lat, lng, radiusM].some(Number.isNaN)) {
    throw new HttpError(400, "lat,lng,radius_m are required numbers");
  }
  if (radiusM <= 0) {
    throw new HttpError(400, "radius_m must be > 0");
  }
  return { lat, lng, radiusM };
}

export function parsePoiBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const kind = typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : "poi";
  const wiki_slug = typeof b.wiki_slug === "string" ? b.wiki_slug.trim() || null : null;
  const props = typeof b.props === "object" && b.props !== null && !Array.isArray(b.props) ? b.props : {};
  const lat = Number(b.lat);
  const lng = Number(b.lng);

  if (!name) throw new HttpError(400, "name is required");
  if ([lat, lng].some(Number.isNaN)) throw new HttpError(400, "lat and lng are required numbers");

  return { name, kind, wiki_slug, props, lat, lng };
}

export function parseUuid(id: unknown) {
  const raw = String(id ?? "");
  if (!validateUuid(raw)) {
    throw new HttpError(400, "id must be a valid uuid");
  }
  return raw;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is [number, number] {
  return Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]);
}

export function parseNeighborhoodBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new HttpError(400, "name is required");

  const polygon = b.polygon;
  if (!isJsonObject(polygon) || polygon.type !== "Polygon" || !Array.isArray(polygon.coordinates)) {
    throw new HttpError(400, "polygon must be a valid GeoJSON Polygon");
  }

  const rings = polygon.coordinates as unknown[];
  if (!rings.length || !Array.isArray(rings[0]) || (rings[0] as unknown[]).length < 4) {
    throw new HttpError(400, "polygon must include a valid outer ring");
  }
  const outerRing = rings[0] as unknown[];
  if (!outerRing.every(isPosition)) {
    throw new HttpError(400, "polygon coordinates must be [lng,lat] numeric pairs");
  }

  const tileUrlTemplate =
    typeof b.tile_url_template === "string" && b.tile_url_template.trim()
      ? b.tile_url_template.trim()
      : null;
  const iso = isJsonObject(b.iso) ? b.iso : {};

  return {
    name,
    polygon: { type: "Polygon", coordinates: polygon.coordinates },
    tileUrlTemplate,
    iso
  };
}

function asFiniteNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `${label} must be a finite number`);
  }
  return parsed;
}

export function parseOverlayProjectBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = typeof b.id === "string" && b.id.trim() ? b.id.trim() : undefined;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const assetPath = typeof b.asset_path === "string" ? b.asset_path.trim() : "";
  const imageWidth = asFiniteNumber(b.image_width, "image_width");
  const imageHeight = asFiniteNumber(b.image_height, "image_height");
  const rows = asFiniteNumber(b.rows, "rows");
  const cols = asFiniteNumber(b.cols, "cols");
  const opacity = asFiniteNumber(b.opacity, "opacity");
  const points = Array.isArray(b.points) ? b.points : [];

  if (!name) throw new HttpError(400, "name is required");
  if (!assetPath) throw new HttpError(400, "asset_path is required");
  if (!Number.isInteger(rows) || rows < 2) throw new HttpError(400, "rows must be an integer >= 2");
  if (!Number.isInteger(cols) || cols < 2) throw new HttpError(400, "cols must be an integer >= 2");
  if (!Number.isInteger(imageWidth) || imageWidth <= 0) throw new HttpError(400, "image_width must be a positive integer");
  if (!Number.isInteger(imageHeight) || imageHeight <= 0) throw new HttpError(400, "image_height must be a positive integer");
  if (opacity < 0 || opacity > 1) throw new HttpError(400, "opacity must be between 0 and 1");
  if (points.length !== rows * cols) {
    throw new HttpError(400, "points must match rows * cols");
  }

  const parsedPoints = points.map((point, index) => {
    const p = (point ?? {}) as Record<string, unknown>;
    try {
      return {
        lat: asFiniteNumber(p.lat, `points[${index}].lat`),
        lng: asFiniteNumber(p.lng, `points[${index}].lng`)
      };
    } catch (err) {
      throw err;
    }
  });

  return {
    id,
    name,
    asset_path: assetPath,
    image_width: imageWidth,
    image_height: imageHeight,
    rows,
    cols,
    opacity,
    points: parsedPoints
  };
}

export function parseOverlayAssetBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const mime = typeof b.mime === "string" ? b.mime.trim().toLowerCase() : "";
  const contentBase64 = typeof b.content_base64 === "string" ? b.content_base64.trim() : "";

  if (!name) throw new HttpError(400, "name is required");
  if (!mime.startsWith("image/png") && !mime.startsWith("image/jpeg")) {
    throw new HttpError(400, "only PNG and JPG uploads are supported");
  }
  if (!contentBase64) throw new HttpError(400, "content_base64 is required");

  return { name, mime, contentBase64 };
}
