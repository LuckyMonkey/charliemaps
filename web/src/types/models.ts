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
  count?: number;
};

export type PhotoPoint = {
  id: string;
  lat: number;
  lng: number;
  weight: number;
  file_path: string;
  taken_at?: string | null;
  count?: number;
};

export type PhotoSplatterLayer = {
  type: "photo-splatter";
  neighborhood_id: string | null;
  points: PhotoPoint[];
};

export type PoiCollection = FeatureCollection<PoiProps>;
export type EmptyPhotoSplatterLayer = {
  type: "photo-splatter";
  neighborhood_id: string | null;
  points: [];
};

export type Selection =
  | { type: "none" }
  | { type: "poi"; id: string; properties: PoiProps }
  | { type: "photo"; id: string; properties: PhotoProps };

export type OverlayPoint = {
  lat: number;
  lng: number;
};

export type OverlayProject = {
  id: string;
  name: string;
  asset_path: string;
  image_width: number;
  image_height: number;
  rows: number;
  cols: number;
  opacity: number;
  points: OverlayPoint[];
  created_at: string;
  updated_at: string;
};

export type OverlayProjectInput = {
  id?: string;
  name: string;
  asset_path: string;
  image_width: number;
  image_height: number;
  rows: number;
  cols: number;
  opacity: number;
  points: OverlayPoint[];
};

export type OverlayProjectList = {
  items: OverlayProject[];
};

export type OverlayAssetUpload = {
  file_name: string;
  asset_path: string;
};
