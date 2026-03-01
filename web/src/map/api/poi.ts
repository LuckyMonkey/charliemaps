import { apiGet } from "./client";
import type { PoiCollection } from "../../types/models";

export function listPoiByNeighborhood(neighborhoodId: string) {
  return apiGet<PoiCollection>(`/neighborhoods/${neighborhoodId}/poi`);
}
