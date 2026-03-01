import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature } from "../types/geojson";
import type { Neighborhood, PhotoCollection, PoiCollection, PoiProps } from "../types/models";
import { getNeighborhoods } from "../api/neighborhoods";
import { getPoiByBbox } from "../api/poi";
import { getNeighborhoodPhotos } from "../api/photos";

export function useMapState() {
  const [search, setSearch] = useState("");
  const [showPoi, setShowPoi] = useState(true);
  const [showPhotos, setShowPhotos] = useState(true);
  const [useStylizedTiles, setUseStylizedTiles] = useState(false);
  const [pois, setPois] = useState<PoiCollection>({ type: "FeatureCollection", features: [] });
  const [photos, setPhotos] = useState<PhotoCollection>({ type: "FeatureCollection", features: [] });
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadNeighborhoods = useCallback(async () => {
    try {
      const res = await getNeighborhoods();
      setNeighborhoods(res.items);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadPoisInBbox = useCallback(async (bbox: string) => {
    try {
      setError(null);
      setPois(await getPoiByBbox(bbox));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadPhotosForNeighborhood = useCallback(async (id: string | null) => {
    if (!id) return setPhotos({ type: "FeatureCollection", features: [] });
    try {
      setError(null);
      setPhotos(await getNeighborhoodPhotos(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const filteredPois = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pois.features;
    return pois.features.filter((f: Feature<PoiProps>) => f.properties.name.toLowerCase().includes(q));
  }, [pois.features, search]);

  useEffect(() => {
    loadNeighborhoods().catch(() => {});
  }, [loadNeighborhoods]);

  return {
    search,
    setSearch,
    showPoi,
    setShowPoi,
    showPhotos,
    setShowPhotos,
    useStylizedTiles,
    setUseStylizedTiles,
    neighborhoods,
    filteredPois,
    photos,
    error,
    loadPoisInBbox,
    loadPhotosForNeighborhood
  };
}
