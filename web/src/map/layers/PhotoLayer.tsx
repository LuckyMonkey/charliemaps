import { CircleMarker, Popup } from "react-leaflet";
import type { Feature } from "../../types/geojson";
import type { PhotoCollection, PhotoProps } from "../../types/models";
import { photoFileUrl } from "../api/photos";

type Props = {
  data: PhotoCollection;
  enabled: boolean;
  onSelect: (id: string, props: PhotoProps) => void;
};

function PhotoMarker({ feature, onSelect }: { feature: Feature<PhotoProps>; onSelect: Props["onSelect"] }) {
  const [lng, lat] = feature.geometry.coordinates;
  const src = photoFileUrl(feature.properties.file_path);
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={5}
      pathOptions={{ color: "#b45309", fillColor: "#f59e0b", fillOpacity: 0.85 }}
      eventHandlers={{ click: () => onSelect(feature.id, feature.properties) }}
    >
      <Popup><img src={src} alt="thumb" style={{ maxWidth: 160 }} /></Popup>
    </CircleMarker>
  );
}

export function PhotoLayer({ data, enabled, onSelect }: Props) {
  if (!enabled) return null;
  return <>{data.features.map((f) => <PhotoMarker key={f.id} feature={f} onSelect={onSelect} />)}</>;
}
