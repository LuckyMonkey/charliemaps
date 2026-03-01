import { useState } from "react";

export function useLayerToggles() {
  const [showPoi, setShowPoi] = useState(true);
  const [showPhotos, setShowPhotos] = useState(true);
  return { showPoi, setShowPoi, showPhotos, setShowPhotos };
}
