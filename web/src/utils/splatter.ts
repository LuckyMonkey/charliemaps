import type { PhotoPoint, PhotoSplatterLayer } from "../types/models";

const CELL_SIZE = 0.0015;

function bucketKey(point: PhotoPoint) {
  const latBucket = Math.round(point.lat / CELL_SIZE);
  const lngBucket = Math.round(point.lng / CELL_SIZE);
  return `${latBucket}:${lngBucket}`;
}

export function aggregatePhotoSplatter(layer: PhotoSplatterLayer): PhotoSplatterLayer {
  const buckets = new Map<string, PhotoPoint[]>();

  for (const point of layer.points) {
    const key = bucketKey(point);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }

  const points = Array.from(buckets.values()).map((bucket) => {
    const count = bucket.length;
    const lat = bucket.reduce((sum, point) => sum + point.lat, 0) / count;
    const lng = bucket.reduce((sum, point) => sum + point.lng, 0) / count;
    const representative = bucket[0];

    return {
      ...representative,
      lat,
      lng,
      weight: Math.min(10, 1 + Math.log2(count)),
      count
    };
  });

  return {
    ...layer,
    points
  };
}
