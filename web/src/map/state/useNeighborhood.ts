import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNeighborhood, listNeighborhoods } from "../api/neighborhoods";
import { listPoiByNeighborhood } from "../api/poi";
import { listPhotosByNeighborhood } from "../api/photos";
import type { Neighborhood, PhotoCollection, PoiCollection } from "../../types/models";

type CachedData = { neighborhood: Neighborhood; poi: PoiCollection; photos: PhotoCollection };

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
        if (!selectedId && res.items.length) setSelectedId(res.items[0].id);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [selectedId]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    if (cache.current[id]) {
      setActive(cache.current[id]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [neighborhood, poi, photos] = await Promise.all([
        getNeighborhood(id),
        listPoiByNeighborhood(id),
        listPhotosByNeighborhood(id)
      ]);
      const data = { neighborhood, poi, photos };
      cache.current[id] = data;
      setActive(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedId);
  }, [selectedId, load]);

  return useMemo(() => ({
    neighborhoods,
    selectedId,
    setSelectedId,
    active,
    loading,
    error
  }), [neighborhoods, selectedId, active, loading, error]);
}
