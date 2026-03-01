export type PointGeometry = { type: "Point"; coordinates: [number, number] };

export type Feature<TProps> = {
  type: "Feature";
  id: string;
  properties: TProps;
  geometry: PointGeometry;
};

export type FeatureCollection<TProps> = {
  type: "FeatureCollection";
  features: Array<Feature<TProps>>;
};
