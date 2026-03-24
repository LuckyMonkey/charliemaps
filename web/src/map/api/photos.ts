import { apiBase, apiGet } from "./client";
import { encodeFilePath } from "../../utils/encode";
import type { PhotoSplatterLayer } from "../../types/models";

export function loadPhotoSplatterByNeighborhood(neighborhoodId: string) {
  return apiGet<PhotoSplatterLayer>(`/neighborhoods/${neighborhoodId}/photo-splatter`);
}

export function loadPhotoSplatter() {
  return loadStaticPhotoSplatter().catch(() => apiGet<PhotoSplatterLayer>("/photos/splatter"));
}

export function photoFileUrl(filePath: string) {
  return `${apiBase()}/photos/file?path=${encodeFilePath(filePath)}`;
}

async function loadStaticPhotoSplatter() {
  const res = await fetch("/data/photo-splatter.json");
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (text ? JSON.parse(text) : {}) as PhotoSplatterLayer;
}
