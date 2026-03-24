import type { Neighborhood, Selection } from "../../types/models";
import { photoFileUrl } from "../api/photos";
import { JsonView } from "./JsonView";

type Props = {
  selection: Selection;
  neighborhood?: Neighborhood;
  photoCount: number;
  poiCount: number;
};

function wikiUrl(slug?: string | null) {
  return slug ? `/doku.php?id=${encodeURIComponent(slug)}` : null;
}

export function SidePanel({ selection, neighborhood, photoCount, poiCount }: Props) {
  if (selection.type === "none") {
    return (
      <aside className="side-panel" tabIndex={0} aria-label="Details panel">
        <h2>{neighborhood?.name ?? "EXIF Splatter"}</h2>
        <p>Pan and zoom the map, then click a splatter point or POI for details.</p>
        <div className="stat-grid">
          <div className="stat-card">
            <strong>{photoCount}</strong>
            <span>Map points</span>
          </div>
          <div className="stat-card">
            <strong>{poiCount}</strong>
            <span>POIs</span>
          </div>
        </div>
        {neighborhood?.tile_url_template ? <p>Using neighborhood raster tiles.</p> : <p>Using OpenStreetMap fallback tiles.</p>}
      </aside>
    );
  }

  if (selection.type === "photo") {
    const src = photoFileUrl(selection.properties.file_path);
    return (
      <aside className="side-panel" tabIndex={0} aria-label="Photo details">
        <h2>Photo</h2>
        {selection.properties.count && selection.properties.count > 1 ? <p><strong>Cluster:</strong> {selection.properties.count} nearby photos</p> : null}
        <p><strong>Taken:</strong> {selection.properties.taken_at || "unknown"}</p>
        <img src={src} alt="selected" className="panel-img" />
        <p><a href={src} target="_blank" rel="noreferrer">Open full image</a></p>
      </aside>
    );
  }

  const link = wikiUrl(selection.properties.wiki_slug);
  return (
    <aside className="side-panel" tabIndex={0} aria-label="POI details">
      <h2>{selection.properties.name}</h2>
      <p><strong>Kind:</strong> {selection.properties.kind}</p>
      {link ? <p><a href={link} target="_blank" rel="noreferrer">Open DokuWiki</a></p> : null}
      <JsonView value={selection.properties.props ?? {}} />
    </aside>
  );
}
