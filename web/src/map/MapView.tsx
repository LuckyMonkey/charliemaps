import { useEffect } from "react";
import { MapContainer, useMap } from "react-leaflet";
import { BaseTileLayer } from "./layers/BaseTileLayer";
import { PoiLayer } from "./layers/PoiLayer";
import { PhotoLayer } from "./layers/PhotoLayer";
import type { Neighborhood, PhotoCollection, PoiCollection } from "../types/models";

function ViewSync({ neighborhood }: { neighborhood?: Neighborhood }) {
  const map = useMap();
  useEffect(() => {
    if (!neighborhood?.bbox) return;
    const b = neighborhood.bbox;
    const center: [number, number] = [(b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2];
    map.setView(center, 0, { animate: false });
  }, [map, neighborhood]);
  return null;
}

type Props = {
  neighborhood?: Neighborhood;
  poi: PoiCollection;
  photos: PhotoCollection;
  showPoi: boolean;
  showPhotos: boolean;
  onSelectPoi: (id: string, props: PoiCollection["features"][number]["properties"]) => void;
  onSelectPhoto: (id: string, props: PhotoCollection["features"][number]["properties"]) => void;
};

const EMPTY: PoiCollection = { type: "FeatureCollection", features: [] };
const EMPTY_PHOTOS: PhotoCollection = { type: "FeatureCollection", features: [] };

export function MapView({ neighborhood, poi, photos, showPoi, showPhotos, onSelectPoi, onSelectPhoto }: Props) {
  return (
    <MapContainer center={[42.36, -71.05]} zoom={0} minZoom={0} maxZoom={0} zoomControl style={{ height: "100%", width: "100%" }}>
      <BaseTileLayer tileUrlTemplate={neighborhood?.tile_url_template} />
      <ViewSync neighborhood={neighborhood} />
      <PoiLayer data={poi || EMPTY} enabled={showPoi} onSelect={onSelectPoi} />
      <PhotoLayer data={photos || EMPTY_PHOTOS} enabled={showPhotos} onSelect={onSelectPhoto} />
    </MapContainer>
  );
}
