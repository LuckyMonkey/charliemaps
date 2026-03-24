import { CircleMarker, Popup, Tooltip } from "react-leaflet";
import type { PhotoPoint, PhotoProps, PhotoSplatterLayer } from "../../types/models";
import { photoFileUrl } from "../api/photos";
import { aggregatePhotoSplatter } from "../../utils/splatter";

type Props = {
  data: PhotoSplatterLayer;
  enabled: boolean;
  onSelect: (id: string, props: PhotoProps) => void;
};

function markerStyle(weight: number) {
  const intensity = Math.min(1, weight / 10);
  return {
    radius: 7 + weight * 2.4,
    color: "#ffffff",
    weight: 2,
    fillColor: intensity > 0.55 ? "#dc2626" : "#ea580c",
    fillOpacity: 0.72 + intensity * 0.18
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
      <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
        {point.count && point.count > 1 ? `${point.count} photos` : "1 photo"}
      </Tooltip>
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
