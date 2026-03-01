type Props = {
  showPoi: boolean;
  showPhotos: boolean;
  setShowPoi: (next: boolean) => void;
  setShowPhotos: (next: boolean) => void;
};

export function LayerToggles({ showPoi, showPhotos, setShowPoi, setShowPhotos }: Props) {
  return (
    <div className="toggles">
      <label><input type="checkbox" checked={showPoi} onChange={(e) => setShowPoi(e.target.checked)} /> POIs</label>
      <label><input type="checkbox" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} /> Photos</label>
    </div>
  );
}
