CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS poi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'poi',
  wiki_slug text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geography(Point,4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poi_geom_gist ON poi USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_poi_kind_btree ON poi (kind);
