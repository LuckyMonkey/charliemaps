import { CircleMarker, Popup } from "react-leaflet";
import type { PhotoPoint, PhotoProps, PhotoSplatterLayer } from "../../types/models";
import { photoFileUrl } from "../api/photos";
import { aggregatePhotoSplatter } from "../../utils/splatter";

type Props = {
  data: PhotoSplatterLayer;
  enabled: boolean;
  onSelect: (id: string, props: PhotoProps) => void;
};

function markerStyle(weight: number) {
  const intensity = Math.min(1, weight / 8);
  return {
    radius: 5 + weight * 2,
    color: "#9a3412",
    fillColor: intensity > 0.55 ? "#ef4444" : "#f59e0b",
    fillOpacity: 0.28 + intensity * 0.4
  };
}

function PhotoMarker({ point, onSelect }: { point: PhotoPoint; onSelect: Props["onSelect"] }) {
  const src = photoFileUrl(point.file_path);
  const style = markerStyle(point.weight);
  return (
    <CircleMarker
      center={[point.lat, point.lng]}
      radius={style.radius}
      pathOptions={style}
      eventHandlers={{ click: () => onSelect(point.id, { file_path: point.file_path, taken_at: point.taken_at, count: point.count }) }}
    >
      <Popup>
        <div>
          {point.count && point.count > 1 ? <strong>{point.count} photos in this cluster</strong> : null}
          <img src={src} alt="thumb" style={{ maxWidth: 160, display: "block", marginTop: 8 }} />
        </div>
      </Popup>
    </CircleMarker>
  );
}

export function PhotoLayer({ data, enabled, onSelect }: Props) {
  if (!enabled) return null;
  const aggregated = aggregatePhotoSplatter(data);
  return <>{aggregated.points.map((point) => <PhotoMarker key={point.id} point={point} onSelect={onSelect} />)}</>;
}
