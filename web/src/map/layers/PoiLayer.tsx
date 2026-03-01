import { CircleMarker, Popup } from "react-leaflet";
import type { PoiCollection, PoiProps } from "../../types/models";
import type { Feature } from "../../types/geojson";

type Props = {
  data: PoiCollection;
  enabled: boolean;
  onSelect: (id: string, props: PoiProps) => void;
};

function PoiMarker({ feature, onSelect }: { feature: Feature<PoiProps>; onSelect: Props["onSelect"] }) {
  const [lng, lat] = feature.geometry.coordinates;
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={6}
      pathOptions={{ color: "#1d4ed8", fillColor: "#60a5fa", fillOpacity: 0.9 }}
      eventHandlers={{ click: () => onSelect(feature.id, feature.properties) }}
    >
      <Popup>{feature.properties.name}</Popup>
    </CircleMarker>
  );
}

export function PoiLayer({ data, enabled, onSelect }: Props) {
  if (!enabled) return null;
  return <>{data.features.map((f) => <PoiMarker key={f.id} feature={f} onSelect={onSelect} />)}</>;
}
