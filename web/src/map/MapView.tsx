import { useEffect } from "react";
import { MapContainer, useMap } from "react-leaflet";
import { BaseTileLayer } from "./layers/BaseTileLayer";
import { PoiLayer } from "./layers/PoiLayer";
import { PhotoLayer } from "./layers/PhotoLayer";
import type { Neighborhood, PhotoProps, PhotoSplatterLayer, PoiCollection } from "../types/models";
import { getNeighborhoodBounds, getPhotoSplatterBounds, getPoiBounds } from "../utils/bounds";

function ViewSync({
  neighborhood,
  poi,
  photoSplatter
}: {
  neighborhood?: Neighborhood;
  poi: PoiCollection;
  photoSplatter: PhotoSplatterLayer;
}) {
  const map = useMap();

  useEffect(() => {
    const bounds =
      getNeighborhoodBounds(neighborhood) ??
      getPhotoSplatterBounds(photoSplatter) ??
      getPoiBounds(poi);

    if (!bounds) return;
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: neighborhood ? 14 : 12 });
  }, [map, neighborhood, poi, photoSplatter]);

  return null;
}

type Props = {
  neighborhood?: Neighborhood;
  poi: PoiCollection;
  photoSplatter: PhotoSplatterLayer;
  showPoi: boolean;
  showPhotos: boolean;
  onSelectPoi: (id: string, props: PoiCollection["features"][number]["properties"]) => void;
  onSelectPhoto: (id: string, props: PhotoProps) => void;
};

const EMPTY: PoiCollection = { type: "FeatureCollection", features: [] };
const EMPTY_PHOTO_SPLATTER: PhotoSplatterLayer = {
  type: "photo-splatter",
  neighborhood_id: "",
  points: []
};

export function MapView({ neighborhood, poi, photoSplatter, showPoi, showPhotos, onSelectPoi, onSelectPhoto }: Props) {
  return (
    <MapContainer center={[42.36, -71.05]} zoom={11} minZoom={3} maxZoom={18} zoomControl style={{ height: "100%", width: "100%" }}>
      <BaseTileLayer tileUrlTemplate={neighborhood?.tile_url_template} />
      <ViewSync neighborhood={neighborhood} poi={poi || EMPTY} photoSplatter={photoSplatter || EMPTY_PHOTO_SPLATTER} />
      <PoiLayer data={poi || EMPTY} enabled={showPoi} onSelect={onSelectPoi} />
      <PhotoLayer data={photoSplatter || EMPTY_PHOTO_SPLATTER} enabled={showPhotos} onSelect={onSelectPhoto} />
    </MapContainer>
  );
}
