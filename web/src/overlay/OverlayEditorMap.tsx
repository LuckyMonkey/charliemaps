import { useEffect, useState } from "react";
import { MapContainer, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import type { OverlayProject } from "../types/models";
import { BaseTileLayer } from "../map/layers/BaseTileLayer";
import { OverlayWarpCanvas } from "./ui/OverlayWarpCanvas";

function MapSync({ project, onMapReady }: { project: OverlayProject | null; onMapReady: (map: LeafletMap) => void }) {
  const map = useMap();

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  useEffect(() => {
    if (!project?.points.length) return;
    const latLngs = project.points.map((point) => [point.lat, point.lng] as [number, number]);
    map.fitBounds(latLngs, { padding: [40, 40], maxZoom: 17 });
  }, [map, project?.id]);

  return null;
}

type Props = {
  project: OverlayProject | null;
  onMapReady: (map: LeafletMap) => void;
  onUpdatePoint: (index: number, lat: number, lng: number) => void;
};

export function OverlayEditorMap({ project, onMapReady, onUpdatePoint }: Props) {
  const [map, setMap] = useState<LeafletMap | null>(null);

  return (
    <div className="editor-map-stage">
      <MapContainer center={[42.36, -71.05]} zoom={12} minZoom={3} maxZoom={19} zoomControl style={{ height: "100%", width: "100%" }}>
        <BaseTileLayer />
        <MapSync
          project={project}
          onMapReady={(next) => {
            setMap(next);
            onMapReady(next);
          }}
        />
      </MapContainer>
      {map && project ? <OverlayWarpCanvas map={map} project={project} onUpdatePoint={onUpdatePoint} /> : null}
      {!project ? <div className="editor-empty">Import a PNG or JPG to start your overlay warp.</div> : null}
    </div>
  );
}
