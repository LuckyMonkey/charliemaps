import { useEffect, useMemo, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import type { OverlayProject } from "../../types/models";

type Props = {
  map: LeafletMap;
  project: OverlayProject;
  onUpdatePoint: (index: number, lat: number, lng: number) => void;
};

export function OverlayHandles({ map, project, onUpdatePoint }: Props) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const rerender = () => setVersion((value) => value + 1);
    map.on("move zoom resize", rerender);
    return () => map.off("move zoom resize", rerender);
  }, [map]);

  const points = useMemo(
    () => project.points.map((point) => map.latLngToContainerPoint([point.lat, point.lng])),
    [map, project, version]
  );

  return (
    <div className="overlay-handles">
      {points.map((point, index) => (
        <button
          key={`${project.id}-${index}`}
          className="overlay-handle"
          style={{ left: point.x, top: point.y }}
          onPointerDown={(event) => {
            event.preventDefault();
            const move = (next: PointerEvent) => {
              const rect = map.getContainer().getBoundingClientRect();
              const latLng = map.containerPointToLatLng([next.clientX - rect.left, next.clientY - rect.top]);
              onUpdatePoint(index, latLng.lat, latLng.lng);
            };
            const stop = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", stop);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", stop);
          }}
          title={`Control ${index + 1}`}
        />
      ))}
    </div>
  );
}
