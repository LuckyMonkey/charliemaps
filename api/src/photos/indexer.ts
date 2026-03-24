import fs from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import { query } from "../db.js";

export type ReindexStats = {
  scanned: number;
  inserted: number;
  updated: number;
  skipped_no_gps: number;
  skipped_errors: number;
};

const SUPPORTED_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"]);

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith("._")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)));
      continue;
    }
    if (entry.isFile() && SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(abs);
    }
  }
  return out;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  return null;
}

export async function reindexPhotos(photosRoot: string): Promise<ReindexStats> {
  const stats: ReindexStats = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    skipped_no_gps: 0,
    skipped_errors: 0
  };

  const files = await walkFiles(photosRoot);
  for (const filePath of files) {
    stats.scanned += 1;
    try {
      const exif = await exifr.parse(filePath, {
        gps: true,
        tiff: true,
        exif: true,
        xmp: true
      });

      const latitude = typeof exif?.latitude === "number" ? exif.latitude : null;
      const longitude = typeof exif?.longitude === "number" ? exif.longitude : null;
      const takenAt = toIsoString(exif?.DateTimeOriginal) ?? toIsoString(exif?.CreateDate);
      const hasGps = latitude !== null && longitude !== null;

      if (!hasGps) {
        stats.skipped_no_gps += 1;
      }

      const sql = `
        INSERT INTO photo (file_path, taken_at, geom, exif, neighborhood_id)
        VALUES (
          $1,
          $2::timestamptz,
          CASE
            WHEN $3::double precision IS NULL OR $4::double precision IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
          END,
          $5::jsonb,
          CASE
            WHEN $3::double precision IS NULL OR $4::double precision IS NULL THEN NULL
            ELSE (
              SELECT n.id
              FROM neighborhood n
              WHERE ST_Contains(
                n.geom::geometry,
                ST_SetSRID(ST_MakePoint($4, $3), 4326)
              )
              LIMIT 1
            )
          END
        )
        ON CONFLICT (file_path) DO UPDATE SET
          taken_at = EXCLUDED.taken_at,
          geom = EXCLUDED.geom,
          exif = EXCLUDED.exif,
          neighborhood_id = EXCLUDED.neighborhood_id
        RETURNING (xmax = 0) AS inserted;
      `;

      const result = await query<{ inserted: boolean }>(sql, [
        filePath,
        takenAt,
        latitude,
        longitude,
        JSON.stringify(exif ?? {})
      ]);
      if (result.rows[0]?.inserted) stats.inserted += 1;
      else stats.updated += 1;
    } catch (err) {
      console.warn(`photo reindex skip ${filePath}:`, err);
      stats.skipped_errors += 1;
    }
  }

  return stats;
}
