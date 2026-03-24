export type GeoJsonFeature = {
  type: "Feature";
  id: string;
  properties: Record<string, unknown>;
  geometry: { type: "Point"; coordinates: [number, number] };
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

export type PoiRow = {
  id: string;
  name: string;
  kind: string;
  wiki_slug: string | null;
  props: Record<string, unknown>;
  created_at: string;
  geometry: string;
  distance_m?: number;
};

export function poiRowToFeature(row: PoiRow): GeoJsonFeature {
  const geometry = JSON.parse(row.geometry) as { type: "Point"; coordinates: [number, number] };
  return {
    type: "Feature",
    id: row.id,
    properties: {
      name: row.name,
      kind: row.kind,
      wiki_slug: row.wiki_slug,
      props: row.props,
      created_at: row.created_at,
      ...(typeof row.distance_m === "number" ? { distance_m: row.distance_m } : {})
    },
    geometry
  };
}

export function poiRowsToFeatureCollection(rows: PoiRow[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map(poiRowToFeature)
  };
}

export type PhotoRow = {
  id: string;
  file_path: string;
  taken_at: string | null;
  geometry: string;
};

export function photoRowsToFeatureCollection(rows: PhotoRow[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature" as const,
      id: row.id,
      properties: {
        file_path: row.file_path,
        taken_at: row.taken_at
      },
      geometry: JSON.parse(row.geometry) as { type: "Point"; coordinates: [number, number] }
    }))
  };
}
