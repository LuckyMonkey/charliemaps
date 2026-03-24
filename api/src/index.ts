import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { query, pool } from "./db.js";
import {
  photoRowsToFeatureCollection,
  poiRowToFeature,
  poiRowsToFeatureCollection,
  type PhotoRow,
  type PoiRow
} from "./geojson.js";
import { reindexPhotos } from "./photos/indexer.js";
import { HttpError, parseBbox, parseNear, parseNeighborhoodBody, parsePoiBody, parseUuid } from "./validate.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);
const photosRoot = process.env.PHOTOS_ROOT ?? "/mnt/photos";

type NeighborhoodRow = {
  id: string;
  name: string;
  bbox: Record<string, unknown>;
  tile_source: string;
  tile_url_template: string | null;
  iso: Record<string, unknown>;
  geometry?: string;
  created_at: string;
};

type PhotoPointRow = {
  id: string;
  file_path: string;
  taken_at: string | null;
  lat: number;
  lng: number;
};

app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get("/health", async (_req, res, next) => {
  try {
    const result = await query<{ now: string }>("SELECT now()::text AS now");
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    next(err);
  }
});

app.get("/poi", async (req, res, next) => {
  try {
    const { minLng, minLat, maxLng, maxLat } = parseBbox(req.query.bbox);
    const result = await query<PoiRow>(
      `
      SELECT
        id,
        name,
        kind,
        wiki_slug,
        props,
        created_at::text,
        ST_AsGeoJSON(geom::geometry) AS geometry
      FROM poi
      WHERE ST_Intersects(
        geom::geometry,
        ST_MakeEnvelope($1,$2,$3,$4,4326)
      )
      ORDER BY created_at DESC
      LIMIT 1000
      `,
      [minLng, minLat, maxLng, maxLat]
    );
    res.json(poiRowsToFeatureCollection(result.rows));
  } catch (err) {
    next(err);
  }
});

app.get("/poi/near", async (req, res, next) => {
  try {
    const { lat, lng, radiusM } = parseNear(req.query as Record<string, unknown>);
    const result = await query<PoiRow>(
      `
      SELECT
        id,
        name,
        kind,
        wiki_slug,
        props,
        created_at::text,
        ST_AsGeoJSON(geom::geometry) AS geometry,
        ST_Distance(
          geom,
          ST_SetSRID(ST_MakePoint($1,$2),4326)::geography
        ) AS distance_m
      FROM poi
      WHERE ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
        $3
      )
      ORDER BY distance_m ASC
      LIMIT 500
      `,
      [lng, lat, radiusM]
    );
    res.json(poiRowsToFeatureCollection(result.rows));
  } catch (err) {
    next(err);
  }
});

app.post("/poi", async (req, res, next) => {
  try {
    const { name, kind, wiki_slug, props, lat, lng } = parsePoiBody(req.body);
    const result = await query<PoiRow>(
      `
      INSERT INTO poi (name, kind, wiki_slug, props, geom)
      VALUES (
        $1,
        $2,
        $3,
        $4::jsonb,
        ST_SetSRID(ST_MakePoint($5,$6),4326)::geography
      )
      RETURNING
        id,
        name,
        kind,
        wiki_slug,
        props,
        created_at::text,
        ST_AsGeoJSON(geom::geometry) AS geometry
      `,
      [name, kind, wiki_slug, JSON.stringify(props), lng, lat]
    );
    res.status(201).json(poiRowToFeature(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

app.get("/poi/:id", async (req, res, next) => {
  try {
    const id = parseUuid(req.params.id);
    const result = await query<PoiRow>(
      `
      SELECT
        id,
        name,
        kind,
        wiki_slug,
        props,
        created_at::text,
        ST_AsGeoJSON(geom::geometry) AS geometry
      FROM poi
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "POI not found");
    }

    res.json(poiRowToFeature(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

app.post("/photos/reindex", async (_req, res, next) => {
  try {
    const stats = await reindexPhotos(photosRoot);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

app.get("/photos/splatter", async (_req, res, next) => {
  try {
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

    res.json({
      type: "photo-splatter",
      neighborhood_id: null,
      points: result.rows.map((row) => ({
        id: row.id,
        lat: row.lat,
        lng: row.lng,
        weight: 1,
        taken_at: row.taken_at,
        file_path: row.file_path
      }))
    });
  } catch (err) {
    next(err);
  }
});

app.get("/neighborhoods", async (_req, res, next) => {
  try {
    const result = await query<NeighborhoodRow>(
      `
      SELECT
        id,
        name,
        bbox,
        tile_source,
        tile_url_template,
        iso,
        created_at::text
      FROM neighborhood
      ORDER BY created_at DESC
      `
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

app.get("/neighborhoods/:id", async (req, res, next) => {
  try {
    const id = parseUuid(req.params.id);
    const result = await query<NeighborhoodRow>(
      `
      SELECT
        id,
        name,
        bbox,
        tile_source,
        tile_url_template,
        iso,
        ST_AsGeoJSON(geom::geometry) AS geometry,
        created_at::text
      FROM neighborhood
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );
    if (!result.rowCount) throw new HttpError(404, "Neighborhood not found");
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post("/neighborhoods", async (req, res, next) => {
  try {
    const { name, polygon, tileUrlTemplate, iso } = parseNeighborhoodBody(req.body);
    const result = await query<NeighborhoodRow>(
      `
      WITH shape AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326) AS g
      )
      INSERT INTO neighborhood (name, geom, bbox, tile_url_template, iso)
      SELECT
        $1,
        g::geography,
        jsonb_build_object(
          'minLng', ST_XMin(ST_Envelope(g)),
          'minLat', ST_YMin(ST_Envelope(g)),
          'maxLng', ST_XMax(ST_Envelope(g)),
          'maxLat', ST_YMax(ST_Envelope(g))
        ),
        $3,
        $4::jsonb
      FROM shape
      RETURNING
        id,
        name,
        bbox,
        tile_source,
        tile_url_template,
        iso,
        created_at::text
      `,
      [name, JSON.stringify(polygon), tileUrlTemplate, JSON.stringify(iso)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get("/neighborhoods/:id/poi", async (req, res, next) => {
  try {
    const neighborhoodId = parseUuid(req.params.id);
    const result = await query<PoiRow>(
      `
      SELECT
        id,
        name,
        kind,
        wiki_slug,
        props,
        created_at::text,
        ST_AsGeoJSON(geom::geometry) AS geometry
      FROM poi
      WHERE neighborhood_id = $1
      ORDER BY created_at DESC
      `,
      [neighborhoodId]
    );
    res.json(poiRowsToFeatureCollection(result.rows));
  } catch (err) {
    next(err);
  }
});

app.get("/neighborhoods/:id/photos", async (req, res, next) => {
  try {
    const neighborhoodId = parseUuid(req.params.id);
    const result = await query<PhotoRow>(
      `
      SELECT
        id,
        file_path,
        taken_at::text,
        ST_AsGeoJSON(geom::geometry) AS geometry
      FROM photo
      WHERE neighborhood_id = $1
        AND geom IS NOT NULL
      ORDER BY taken_at NULLS LAST, created_at DESC
      `,
      [neighborhoodId]
    );
    res.json(photoRowsToFeatureCollection(result.rows));
  } catch (err) {
    next(err);
  }
});

app.get("/neighborhoods/:id/photo-splatter", async (req, res, next) => {
  try {
    const neighborhoodId = parseUuid(req.params.id);
    const result = await query<PhotoPointRow>(
      `
      SELECT
        id,
        file_path,
        taken_at::text,
        ST_Y(geom::geometry) AS lat,
        ST_X(geom::geometry) AS lng
      FROM photo
      WHERE neighborhood_id = $1
        AND geom IS NOT NULL
      ORDER BY taken_at NULLS LAST, created_at DESC
      `,
      [neighborhoodId]
    );

    res.json({
      type: "photo-splatter",
      neighborhood_id: neighborhoodId,
      points: result.rows.map((row) => ({
        id: row.id,
        lat: row.lat,
        lng: row.lng,
        weight: 1,
        taken_at: row.taken_at,
        file_path: row.file_path
      }))
    });
  } catch (err) {
    next(err);
  }
});

app.get("/photos/file", async (req, res, next) => {
  try {
    const rawPath = String(req.query.path ?? "");
    if (!rawPath) throw new HttpError(400, "path is required");

    const rootResolved = path.resolve(photosRoot);
    const requestedResolved = path.resolve(rootResolved, rawPath);
    if (requestedResolved !== rootResolved && !requestedResolved.startsWith(`${rootResolved}${path.sep}`)) {
      throw new HttpError(400, "invalid photo path");
    }

    await fs.access(requestedResolved);
    res.sendFile(requestedResolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return next(new HttpError(404, "photo not found"));
    }
    next(err);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: "internal server error" });
});

const server = app.listen(port, () => {
  console.log(`api listening on ${port}`);
});

process.on("SIGTERM", async () => {
  server.close();
  await pool.end();
});
