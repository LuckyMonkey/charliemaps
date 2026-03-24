import { apiBase, apiGet } from "./client";
import { encodeFilePath } from "../../utils/encode";
import type { PhotoSplatterLayer } from "../../types/models";

export function loadPhotoSplatterByNeighborhood(neighborhoodId: string) {
  return apiGet<PhotoSplatterLayer>(`/neighborhoods/${neighborhoodId}/photo-splatter`);
}

export function loadPhotoSplatter() {
  return apiGet<PhotoSplatterLayer>("/photos/splatter");
}

export function photoFileUrl(filePath: string) {
  return `${apiBase()}/photos/file?path=${encodeFilePath(filePath)}`;
}
