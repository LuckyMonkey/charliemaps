import fs from "node:fs/promises";
import path from "node:path";
import { query } from "../db.js";

export type PhotoPointRow = {
  id: string;
  file_path: string;
  taken_at: string | null;
  lat: number;
  lng: number;
};

export type PhotoSplatterPoint = {
  id: string;
  lat: number;
  lng: number;
  weight: number;
  taken_at: string | null;
  file_path: string;
};

export type PhotoSplatterLayer = {
  type: "photo-splatter";
  neighborhood_id: string | null;
  generated_at: string;
  source_root: string | null;
  bbox: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null;
  points: PhotoSplatterPoint[];
};

function buildBbox(rows: PhotoPointRow[]) {
  if (!rows.length) {
    return null;
  }

  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    minLat = Math.min(minLat, row.lat);
    minLng = Math.min(minLng, row.lng);
    maxLat = Math.max(maxLat, row.lat);
    maxLng = Math.max(maxLng, row.lng);
  }

  return { minLat, minLng, maxLat, maxLng };
}

export async function buildGlobalPhotoSplatterLayer(photosRoot: string | null) {
  const result = await query<PhotoPointRow>(
    `
    SELECT
      id,
      file_path,
      taken_at::text,
      ST_Y(geom::geometry) AS lat,
      ST_X(geom::geometry) AS lng
    FROM photo
    WHERE geom IS NOT NULL
    ORDER BY taken_at NULLS LAST, created_at DESC
    `
  );

  return {
    type: "photo-splatter",
    neighborhood_id: null,
    generated_at: new Date().toISOString(),
    source_root: photosRoot,
    bbox: buildBbox(result.rows),
    points: result.rows.map((row) => ({
      id: row.id,
      lat: row.lat,
      lng: row.lng,
      weight: 1,
      taken_at: row.taken_at,
      file_path: row.file_path
    }))
  } satisfies PhotoSplatterLayer;
}

export async function writePhotoSplatterLayer(layerPath: string, layer: PhotoSplatterLayer) {
  await fs.mkdir(path.dirname(layerPath), { recursive: true });
  await fs.writeFile(layerPath, `${JSON.stringify(layer, null, 2)}\n`, "utf8");
}

export async function readPhotoSplatterLayer(layerPath: string) {
  const raw = await fs.readFile(layerPath, "utf8");
  return JSON.parse(raw) as PhotoSplatterLayer;
}
