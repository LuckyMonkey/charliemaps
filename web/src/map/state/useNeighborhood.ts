import { useEffect, useRef, useState } from "react";
import { getNeighborhood, listNeighborhoods } from "../api/neighborhoods";
import { listPoiByNeighborhood } from "../api/poi";
import { loadPhotoSplatter, loadPhotoSplatterByNeighborhood } from "../api/photos";
import type { Neighborhood, PhotoSplatterLayer, PoiCollection } from "../../types/models";

type CachedData = { neighborhood?: Neighborhood; poi: PoiCollection; photoSplatter: PhotoSplatterLayer };

const EMPTY_POI: PoiCollection = { type: "FeatureCollection", features: [] };

export function useNeighborhood() {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [active, setActive] = useState<CachedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Record<string, CachedData>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await listNeighborhoods();
        setNeighborhoods(res.items);
        if (!selectedId && res.items.length) {
          setSelectedId(res.items[0].id);
          return;
        }

        if (!res.items.length) {
          const globalPhotos = await loadPhotoSplatter();
          setActive({
            poi: EMPTY_POI,
            photoSplatter: globalPhotos
          });
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;

    void (async () => {
      if (cache.current[selectedId]) {
        setActive(cache.current[selectedId]);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [neighborhood, poi, photos] = await Promise.all([
          getNeighborhood(selectedId),
          listPoiByNeighborhood(selectedId),
          loadPhotoSplatterByNeighborhood(selectedId)
        ]);

        const data = { neighborhood, poi, photoSplatter: photos };
        cache.current[selectedId] = data;
        setActive(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedId]);

  return {
    neighborhoods,
    selectedId,
    setSelectedId,
    active,
    loading,
    error
  };
}
