import { apiBase, apiGet } from "./client";
import { encodeFilePath } from "../../utils/encode";
import type { PhotoCollection } from "../../types/models";

export function listPhotosByNeighborhood(neighborhoodId: string) {
  return apiGet<PhotoCollection>(`/neighborhoods/${neighborhoodId}/photos`);
}

export function photoFileUrl(filePath: string) {
  return `${apiBase()}/photos/file?path=${encodeFilePath(filePath)}`;
}
