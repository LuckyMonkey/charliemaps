import type { Selection } from "../../types/models";
import { photoFileUrl } from "../api/photos";
import { JsonView } from "./JsonView";

type Props = { selection: Selection };

function wikiUrl(slug?: string | null) {
  return slug ? `/doku.php?id=${encodeURIComponent(slug)}` : null;
}

export function SidePanel({ selection }: Props) {
  if (selection.type === "none") {
    return <aside className="side-panel" tabIndex={0}><h2>Details</h2><p>Select a POI or photo marker.</p></aside>;
  }

  if (selection.type === "photo") {
    const src = photoFileUrl(selection.properties.file_path);
    return (
      <aside className="side-panel" tabIndex={0}>
        <h2>Photo</h2>
        <p><strong>Taken:</strong> {selection.properties.taken_at || "unknown"}</p>
        <img src={src} alt="selected" className="panel-img" />
        <p><a href={src} target="_blank" rel="noreferrer">Open full image</a></p>
      </aside>
    );
  }

  const link = wikiUrl(selection.properties.wiki_slug);
  return (
    <aside className="side-panel" tabIndex={0}>
      <h2>{selection.properties.name}</h2>
      <p><strong>Kind:</strong> {selection.properties.kind}</p>
      {link ? <p><a href={link} target="_blank" rel="noreferrer">Open DokuWiki</a></p> : null}
      <JsonView value={selection.properties.props ?? {}} />
    </aside>
  );
}
