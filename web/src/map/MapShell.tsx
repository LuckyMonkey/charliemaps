import { MapView } from "./MapView";
import { useNeighborhood } from "./state/useNeighborhood";
import { useLayerToggles } from "./state/useLayerToggles";
import { useSelection } from "./state/useSelection";
import { NeighborhoodSelect } from "./ui/NeighborhoodSelect";
import { LayerToggles } from "./ui/LayerToggles";
import { SidePanel } from "./ui/SidePanel";
import { FullscreenButton } from "./ui/FullscreenButton";
import type { EmptyPhotoSplatterLayer, PoiCollection } from "../types/models";
import { routes } from "../app/routes";

const EMPTY_POI: PoiCollection = { type: "FeatureCollection", features: [] };
const EMPTY_PHOTO_SPLATTER: EmptyPhotoSplatterLayer = {
  type: "photo-splatter",
  neighborhood_id: "",
  points: []
};

export function MapShell() {
  const n = useNeighborhood();
  const toggles = useLayerToggles();
  const { selection, setSelection } = useSelection();

  return (
    <div className="layout">
      <div className="top-controls">
        <div className="brand-block">
          <span className="brand-kicker">CharlieMaps</span>
          <strong className="brand-title">EXIF Splatter Explorer</strong>
        </div>
        <a href={`#${routes.overlays}`} className="action-button nav-link">Overlay editor</a>
        <NeighborhoodSelect items={n.neighborhoods} value={n.selectedId} onChange={n.setSelectedId} />
        <LayerToggles {...toggles} />
        <FullscreenButton />
      </div>
      <div className="map-wrap">
        <MapView
          neighborhood={n.active?.neighborhood}
          poi={n.active?.poi ?? EMPTY_POI}
          photoSplatter={n.active?.photoSplatter ?? EMPTY_PHOTO_SPLATTER}
          showPoi={toggles.showPoi}
          showPhotos={toggles.showPhotos}
          onSelectPoi={(id, properties) => setSelection({ type: "poi", id, properties })}
          onSelectPhoto={(id, properties) => setSelection({ type: "photo", id, properties })}
        />
      </div>
      <SidePanel
        selection={selection}
        neighborhood={n.active?.neighborhood}
        photoCount={n.active?.photoSplatter.points.length ?? 0}
        poiCount={n.active?.poi.features.length ?? 0}
      />
      {n.loading ? <div className="status">Loading...</div> : null}
      {n.error ? <div className="status error">{n.error}</div> : null}
    </div>
  );
}
