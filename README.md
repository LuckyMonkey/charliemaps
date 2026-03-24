# charliemaps - Step 4 MVP (Neighborhood Map UI)

Minimal PostGIS-backed map app using Node 20, Express, Vite, React, TypeScript, and Leaflet.

## Run

```bash
docker compose up --build
```

The API service automatically runs SQL migrations from `/db/migrations` on startup.
Photos are indexed from `PHOTOS_ROOT` (`/mnt/photos` in container), mounted read-only from host `./photos`.
If port `8080` is busy, set a different host bind: `API_PORT=8081 docker-compose up --build`.
If port `5173` is busy, set a different web bind: `WEB_PORT=5174 docker-compose up --build`.
To index a real host folder of images, override the mount source with `PHOTOS_HOST_PATH=/absolute/host/path`.

- API: http://localhost:8080
- Web: http://localhost:5173
- Health: http://localhost:8080/health

## Structure

- `/api` Express API + migration runner + photo indexer
- `/web` Vite + React + Leaflet frontend
- `/db/init` base DB init SQL (extensions)
- `/db/migrations` ordered SQL migrations
- `/photos` host-backed folder for image files (mounted read-only into API container)
- `/tiles` raster tiles served by the web app at `/tiles/...`

## Migration flow

- `db/init/001_init.sql` is run by Postgres on first DB boot.
- `api/src/migrate.ts` tracks applied files in `schema_migrations` and applies pending SQL files from `/db/migrations` lexicographically.
- POI schema lives in `db/migrations/002_poi.sql`.
- Neighborhood/photo/portal/session schema lives in `db/migrations/003_neighborhoods_photos.sql`.

## Frontend Config

- `VITE_API_BASE` defaults to `http://localhost:8080`
- Override it when needed:

```bash
VITE_API_BASE=http://localhost:8081 docker compose up --build
```

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
- `GET /photos/splatter`
- `GET /photos/file?path=...`
- `GET /neighborhoods`
- `GET /neighborhoods/:id`
- `POST /neighborhoods`
- `GET /neighborhoods/:id/poi`
- `GET /neighborhoods/:id/photos`
- `GET /neighborhoods/:id/photo-splatter`

List endpoints return GeoJSON `FeatureCollection`. `GET /poi/:id` returns a single GeoJSON `Feature`.

The frontend uses `GET /neighborhoods/:id/photo-splatter` as the intermediate JSON map layer for EXIF points instead of binding raw photo files directly onto the map.
For quick global EXIF loading before neighborhood assignment, use `GET /photos/splatter`.

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
