import type { LatLngBoundsExpression } from "leaflet";
import type { Neighborhood, PhotoSplatterLayer, PoiCollection } from "../types/models";

export function getNeighborhoodBounds(neighborhood?: Neighborhood): LatLngBoundsExpression | null {
  if (!neighborhood?.bbox) return null;
  const { minLat, minLng, maxLat, maxLng } = neighborhood.bbox;
  return [
    [minLat, minLng],
    [maxLat, maxLng]
  ];
}

export function getPhotoSplatterBounds(layer: PhotoSplatterLayer): LatLngBoundsExpression | null {
  if (!layer.points.length) return null;

  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const point of layer.points) {
    minLat = Math.min(minLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLat = Math.max(maxLat, point.lat);
    maxLng = Math.max(maxLng, point.lng);
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng]
  ];
}

export function getPoiBounds(poi: PoiCollection): LatLngBoundsExpression | null {
  if (!poi.features.length) return null;

  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const feature of poi.features) {
    const [lng, lat] = feature.geometry.coordinates;
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lng);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lng);
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng]
  ];
}
