# charliemaps - Step 3 MVP (Neighborhoods + EXIF Photos)

Minimal PostGIS-backed API using Node 20 + Express + TypeScript.

## Run

```bash
docker compose up --build
```

The API service automatically runs SQL migrations from `/db/migrations` on startup.
Photos are indexed from `PHOTOS_ROOT` (`/mnt/photos` in container), mounted read-only from host `./photos`.
If port `8080` is busy, set a different host bind: `API_PORT=8081 docker-compose up --build`.

- API: http://localhost:8080
- Health: http://localhost:8080/health

## Structure

- `/api` Express API + migration runner + photo indexer
- `/db/init` base DB init SQL (extensions)
- `/db/migrations` ordered SQL migrations
- `/photos` host-backed folder for image files (mounted read-only into API container)

## Migration flow

- `db/init/001_init.sql` is run by Postgres on first DB boot.
- `api/src/migrate.ts` tracks applied files in `schema_migrations` and applies pending SQL files from `/db/migrations` lexicographically.
- POI schema lives in `db/migrations/002_poi.sql`.
- Neighborhood/photo/portal/session schema lives in `db/migrations/003_neighborhoods_photos.sql`.

## Endpoints

- `GET /health`
- `GET /poi?bbox=minLng,minLat,maxLng,maxLat`
- `GET /poi/near?lat=..&lng=..&radius_m=..`
- `POST /poi`
- `GET /poi/:id`
- `POST /photos/reindex`
- `GET /photos/file?path=...`
- `GET /neighborhoods`
- `POST /neighborhoods`
- `GET /neighborhoods/:id/photos`

List endpoints return GeoJSON `FeatureCollection`. `GET /poi/:id` returns a single GeoJSON `Feature`.

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

List geotagged photos in a neighborhood:

```bash
curl -s http://localhost:8080/neighborhoods/<neighborhood-uuid>/photos | jq
```

Serve a file (must be under `PHOTOS_ROOT`):

```bash
curl -I "http://localhost:8080/photos/file?path=subfolder/example.jpg"
```
