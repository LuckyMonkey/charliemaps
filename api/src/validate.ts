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
