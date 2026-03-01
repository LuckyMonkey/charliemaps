import { MapView } from "./MapView";
import { useNeighborhood } from "./state/useNeighborhood";
import { useLayerToggles } from "./state/useLayerToggles";
import { useSelection } from "./state/useSelection";
import { NeighborhoodSelect } from "./ui/NeighborhoodSelect";
import { LayerToggles } from "./ui/LayerToggles";
import { SidePanel } from "./ui/SidePanel";
import { FullscreenButton } from "./ui/FullscreenButton";

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] } as const;

export function MapShell() {
  const n = useNeighborhood();
  const toggles = useLayerToggles();
  const { selection, setSelection } = useSelection();

  return (
    <div className="layout">
      <div className="top-controls">
        <NeighborhoodSelect items={n.neighborhoods} value={n.selectedId} onChange={n.setSelectedId} />
        <LayerToggles {...toggles} />
        <FullscreenButton />
      </div>
      <div className="map-wrap">
        <MapView
          neighborhood={n.active?.neighborhood}
          poi={n.active?.poi ?? EMPTY_COLLECTION}
          photos={n.active?.photos ?? EMPTY_COLLECTION}
          showPoi={toggles.showPoi}
          showPhotos={toggles.showPhotos}
          onSelectPoi={(id, properties) => setSelection({ type: "poi", id, properties })}
          onSelectPhoto={(id, properties) => setSelection({ type: "photo", id, properties })}
        />
      </div>
      <SidePanel selection={selection} />
      {n.loading ? <div className="status">Loading...</div> : null}
      {n.error ? <div className="status error">{n.error}</div> : null}
    </div>
  );
}
