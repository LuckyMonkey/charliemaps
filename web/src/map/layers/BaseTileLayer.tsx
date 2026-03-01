import { TileLayer } from "react-leaflet";

type Props = { tileUrlTemplate?: string | null };

const OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export function BaseTileLayer({ tileUrlTemplate }: Props) {
  return <TileLayer url={tileUrlTemplate || OSM} attribution="&copy; OpenStreetMap contributors" />;
}
