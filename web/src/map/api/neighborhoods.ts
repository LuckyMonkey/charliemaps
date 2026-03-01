import { apiGet } from "./client";
import type { Neighborhood } from "../../types/models";

export function listNeighborhoods() {
  return apiGet<{ items: Neighborhood[] }>("/neighborhoods");
}

export function getNeighborhood(id: string) {
  return apiGet<Neighborhood>(`/neighborhoods/${id}`);
}
