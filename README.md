# charliemaps - Step 4 MVP (Neighborhood Map UI)

Minimal PostGIS-backed map app using Node 20, Express, Vite, React, TypeScript, and Leaflet.

## Run

```bash
docker compose up --build
```

The API service automatically runs SQL migrations from `/db/migrations` on startup.
Photos are indexed from `PHOTOS_ROOT` (`/mnt/photos` in container), mounted read-only from host `./photos`.
The API exports a real JSON layer file at `PHOTO_LAYER_PATH` (default `/app/data/photo-splatter.json`) and the map reads that layer through `GET /photos/splatter`.
If port `8080` is busy, set a different host bind: `API_PORT=8081 docker-compose up --build`.
If port `5173` is busy, set a different web bind: `WEB_PORT=5174 docker-compose up --build`.
To index a real host folder of images, override the mount source with `PHOTOS_HOST_PATH=/absolute/host/path`.

- API: http://localhost:8080
- Web: http://localhost:5173
- Health: http://localhost:8080/health

## Structure

- `/api` Express API + migration runner + photo indexer
- `/web` Vite + React + Leaflet frontend
- `/api/src/imports` host-side photo import tool for local cloud mirrors
- `/db/init` base DB init SQL (extensions)
- `/db/migrations` ordered SQL migrations
- `/photos` host-backed folder for image files (mounted read-only into API container)
- `/data` exported JSON layer artifacts such as `photo-splatter.json`
- `/tiles` raster tiles served by the web app at `/tiles/...`

## Migration flow

- `db/init/001_init.sql` is run by Postgres on first DB boot.
- `api/src/migrate.ts` tracks applied files in `schema_migrations` and applies pending SQL files from `/db/migrations` lexicographically.
- POI schema lives in `db/migrations/002_poi.sql`.
- Neighborhood/photo/portal/session schema lives in `db/migrations/003_neighborhoods_photos.sql`.

## Frontend Config

- `VITE_API_BASE` defaults to `http://localhost:8080`
- `VITE_API_PORT` defaults to `8080`
- Override it when needed:

```bash
VITE_API_BASE=http://localhost:8081 docker compose up --build
```

For remote access via `fridge.local`, the web app also supports same-host API resolution and same-origin static JSON data in `/data/photo-splatter.json`.

## Separate Photo Import System

The multi-source photo import system is separate from the map runtime.

Use it when you want to ingest local mirrors of:
- OneDrive
- Google Drive
- iCloud exports
- other photo folders

It scans absolute host paths directly and writes JSON artifacts under `data/imports/`.

Setup:

```bash
cp data/import-sources.example.json data/import-sources.json
```

Edit `data/import-sources.json` and point each source at a real host path.

Run the importer from the host:

```bash
cd api
npm run import:photos
```

Outputs:
- `data/imports/photo-catalog.json` : all scanned photos plus EXIF payloads
- `data/imports/photo-layer.json` : GPS-only map layer JSON

This importer does not require the map to be running.

- `PHOTOS_HOST_PATH` defaults to `./photos`
- Example using a real image folder on this machine:

```bash
PHOTOS_HOST_PATH='/home/fridge/shared/shared/gdrive backup' API_PORT=8081 WEB_PORT=5173 docker-compose up --build
```

## Neighborhood Tiles

For a neighborhood-specific raster base layer, set `neighborhood.tile_url_template` to a Leaflet-compatible URL such as:

```text
/tiles/beacon-hill/{z}/{x}/{y}.png
```

The `web` service mounts the repo `./tiles` directory into `web/public/tiles`, so files placed under:

```text
tiles/beacon-hill/0/0/0.png
```

are served by the frontend as:

```text
/tiles/beacon-hill/0/0/0.png
```

If `tile_url_template` is null, the frontend falls back to OpenStreetMap for that neighborhood.

## Endpoints

- `GET /health`
- `GET /poi?bbox=minLng,minLat,maxLng,maxLat`
- `GET /poi/near?lat=..&lng=..&radius_m=..`
- `POST /poi`
- `GET /poi/:id`
- `POST /photos/reindex`
- `POST /photos/rebuild-layer`
- `GET /photos/splatter`
- `GET /photos/file?path=...`
- `GET /neighborhoods`
- `GET /neighborhoods/:id`
- `POST /neighborhoods`
- `GET /neighborhoods/:id/poi`
- `GET /neighborhoods/:id/photos`
- `GET /neighborhoods/:id/photo-splatter`

List endpoints return GeoJSON `FeatureCollection`. `GET /poi/:id` returns a single GeoJSON `Feature`.

The frontend uses `GET /neighborhoods/:id/photo-splatter` and `GET /photos/splatter` as intermediate JSON map layers for EXIF points instead of binding raw photo files directly onto the map.
`GET /photos/splatter` is file-backed by the exported layer at `PHOTO_LAYER_PATH`.
For the global no-neighborhood view, the web app first tries the same-origin static file `/data/photo-splatter.json` and then falls back to the API.

## Example curl

Create POI:

```bash
curl -s -X POST http://localhost:8080/poi \
  -H 'content-type: application/json' \
  -d '{"name":"Boston Common","kind":"park","wiki_slug":"places:boston_common","props":{"city":"Boston"},"lat":42.355,"lng":-71.0656}' | jq
```

BBox query around it:

```bash
curl -s "http://localhost:8080/poi?bbox=-71.09,42.34,-71.04,42.37" | jq
```

Near query:

```bash
curl -s "http://localhost:8080/poi/near?lat=42.355&lng=-71.0656&radius_m=1500" | jq
```

Get by id:

```bash
curl -s http://localhost:8080/poi/<poi-uuid> | jq
```

Create neighborhood:

```bash
curl -s -X POST http://localhost:8080/neighborhoods \
  -H 'content-type: application/json' \
  -d '{
    "name":"Downtown",
    "polygon":{"type":"Polygon","coordinates":[[[-71.08,42.34],[-71.03,42.34],[-71.03,42.37],[-71.08,42.37],[-71.08,42.34]]]},
    "iso":{"mood":"urban"}
  }' | jq
```

Reindex photos from mounted folder:

```bash
curl -s -X POST http://localhost:8080/photos/reindex | jq
```

Rebuild the global JSON layer file from indexed photos:

```bash
curl -s -X POST http://localhost:8080/photos/rebuild-layer | jq
```

Load all indexed EXIF points as a lightweight JSON splatter layer:

```bash
curl -s http://localhost:8080/photos/splatter | jq
```

List geotagged photos in a neighborhood:

```bash
curl -s http://localhost:8080/neighborhoods/<neighborhood-uuid>/photos | jq
```

Load the lightweight EXIF splatter layer for the map:

```bash
curl -s http://localhost:8080/neighborhoods/<neighborhood-uuid>/photo-splatter | jq
```

Serve a file (must be under `PHOTOS_ROOT`):

```bash
curl -I "http://localhost:8080/photos/file?path=subfolder/example.jpg"
```
