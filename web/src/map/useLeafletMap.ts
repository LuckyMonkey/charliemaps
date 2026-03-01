import { useEffect, useMemo, useRef } from "react";
import L, { type Map as LeafletMap } from "leaflet";

export function useLeafletMap(containerId: string) {
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (mapRef.current) return;
    mapRef.current = L.map(containerId, { zoomControl: true }).setView([42.3601, -71.0589], 12);
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [containerId]);

  const baseLayers = useMemo(() => ({
    osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OSM" }),
    stylized: L.tileLayer("/tiles/{z}/{x}/{y}.png", { attribution: "local stylized tiles" })
  }), []);

  useEffect(() => {
    if (!mapRef.current) return;
    baseLayers.osm.addTo(mapRef.current);
  }, [baseLayers]);

  return { mapRef, baseLayers };
}
