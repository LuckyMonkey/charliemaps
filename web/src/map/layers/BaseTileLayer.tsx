import { TileLayer } from "react-leaflet";

type Props = { tileUrlTemplate?: string | null };

const SIMPLE_LAND = "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";

export function BaseTileLayer({ tileUrlTemplate }: Props) {
  return (
    <TileLayer
      url={tileUrlTemplate || SIMPLE_LAND}
      attribution={
        tileUrlTemplate
          ? "&copy; neighborhood tiles"
          : "&copy; OpenStreetMap contributors &copy; CARTO"
      }
    />
  );
}
