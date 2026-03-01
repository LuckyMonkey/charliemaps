import type { FeatureCollection } from "./geojson";

export type Neighborhood = {
  id: string;
  name: string;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  tile_source: string;
  tile_url_template?: string | null;
  iso: Record<string, unknown>;
  geometry?: unknown;
  created_at: string;
};

export type PoiProps = {
  name: string;
  kind: string;
  wiki_slug?: string | null;
  props?: Record<string, unknown>;
  created_at?: string;
};

export type PhotoProps = {
  file_path: string;
  taken_at?: string | null;
};

export type PoiCollection = FeatureCollection<PoiProps>;
export type PhotoCollection = FeatureCollection<PhotoProps>;

export type Selection =
  | { type: "none" }
  | { type: "poi"; id: string; properties: PoiProps }
  | { type: "photo"; id: string; properties: PhotoProps };
