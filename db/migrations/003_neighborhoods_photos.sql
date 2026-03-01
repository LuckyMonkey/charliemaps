CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS neighborhood (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  geom geography(Polygon,4326) NOT NULL,
  bbox jsonb NOT NULL DEFAULT '{}'::jsonb,
  tile_source text NOT NULL DEFAULT 'tiled',
  tile_url_template text,
  iso jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neighborhood_geom_gist ON neighborhood USING GIST (geom);

ALTER TABLE poi
  ADD COLUMN IF NOT EXISTS neighborhood_id uuid REFERENCES neighborhood(id);

CREATE INDEX IF NOT EXISTS idx_poi_neighborhood_id_btree ON poi (neighborhood_id);

CREATE TABLE IF NOT EXISTS photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path text UNIQUE NOT NULL,
  taken_at timestamptz,
  geom geography(Point,4326),
  exif jsonb NOT NULL DEFAULT '{}'::jsonb,
  neighborhood_id uuid REFERENCES neighborhood(id),
  poi_id uuid REFERENCES poi(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_geom_gist ON photo USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_photo_neighborhood_id_btree ON photo (neighborhood_id);

CREATE TABLE IF NOT EXISTS portal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_neighborhood_id uuid NOT NULL REFERENCES neighborhood(id),
  kind text NOT NULL,
  station_id text,
  to_neighborhood_id uuid REFERENCES neighborhood(id),
  geom geography(Point,4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_geom_gist ON portal USING GIST (geom);

CREATE TABLE IF NOT EXISTS route_session_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  start_neighborhood_id uuid REFERENCES neighborhood(id),
  end_neighborhood_id uuid REFERENCES neighborhood(id),
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_seconds int NOT NULL DEFAULT 0
);
