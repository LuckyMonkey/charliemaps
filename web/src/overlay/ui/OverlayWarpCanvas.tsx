import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import type { OverlayProject } from "../../types/models";
import { overlayAssetUrl } from "../api/overlays";
import { drawOverlayGrid, drawWarpedOverlay } from "../../utils/overlayWarp";
import { OverlayHandles } from "./OverlayHandles";

type Props = {
  map: LeafletMap;
  project: OverlayProject;
  onUpdatePoint: (index: number, lat: number, lng: number) => void;
};

export function OverlayWarpCanvas({ map, project, onUpdatePoint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const next = new Image();
    next.onload = () => setImage(next);
    next.src = overlayAssetUrl(project.asset_path);
  }, [project.asset_path]);

  useEffect(() => {
    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);
      const points = project.points.map((point) => map.latLngToContainerPoint([point.lat, point.lng]));
      drawWarpedOverlay(ctx, image, project, points);
      drawOverlayGrid(ctx, project, points);
    };

    render();
    map.on("move zoom resize", render);
    return () => map.off("move zoom resize", render);
  }, [image, map, project]);

  return (
    <>
      <canvas ref={canvasRef} className="overlay-canvas" />
      <OverlayHandles map={map} project={project} onUpdatePoint={onUpdatePoint} />
    </>
  );
}
