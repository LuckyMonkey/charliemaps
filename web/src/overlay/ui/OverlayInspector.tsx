import { overlayAssetUrl } from "../api/overlays";
import type { OverlayProject } from "../../types/models";

type Props = {
  project: OverlayProject | null;
  busy: boolean;
  onNameChange: (name: string) => void;
  onOpacityChange: (opacity: number) => void;
  onSave: () => Promise<void>;
};

export function OverlayInspector({ project, busy, onNameChange, onOpacityChange, onSave }: Props) {
  if (!project) {
    return (
      <aside className="editor-inspector">
        <h2>No overlay loaded</h2>
        <p>Import a PNG or JPG to start a warp project.</p>
      </aside>
    );
  }

  return (
    <aside className="editor-inspector">
      <h2>{project.name}</h2>
      <label className="control">
        Project name
        <input value={project.name} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <label className="control">
        Opacity
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={project.opacity}
          onChange={(event) => onOpacityChange(Number(event.target.value))}
        />
      </label>
      <div className="stat-grid">
        <div className="stat-card">
          <strong>{project.rows}x{project.cols}</strong>
          <span>Control dots</span>
        </div>
        <div className="stat-card">
          <strong>{project.image_width}x{project.image_height}</strong>
          <span>Source pixels</span>
        </div>
      </div>
      <img src={overlayAssetUrl(project.asset_path)} alt={project.name} className="panel-img" />
      <p><strong>Updated:</strong> {project.updated_at}</p>
      <button className="action-button" onClick={() => void onSave()} disabled={busy}>Save overlay</button>
    </aside>
  );
}
