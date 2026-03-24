import { routes } from "../../app/routes";
import type { OverlayProject } from "../../types/models";

type Props = {
  busy: boolean;
  projects: OverlayProject[];
  activeId: string;
  onSelectProject: (id: string) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
};

export function OverlaySidebar({ busy, projects, activeId, onSelectProject, onUpload }: Props) {
  return (
    <aside className="editor-sidebar">
      <div className="editor-header">
        <a href={`#${routes.home}`} className="editor-link">Back to map</a>
        <h1>Overlay Editor</h1>
        <p>Upload a PNG or JPG, drag the dot matrix onto streets, then save the project JSON.</p>
      </div>
      <label className="action-button editor-upload">
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void onUpload(file);
              event.target.value = "";
            }
          }}
        />
        Import PNG/JPG
      </label>
      <div className="editor-list">
        {projects.map((project) => (
          <button
            key={project.id}
            className={`editor-project ${project.id === activeId ? "active" : ""}`}
            onClick={() => void onSelectProject(project.id)}
            disabled={busy}
          >
            <strong>{project.name}</strong>
            <span>{project.rows}x{project.cols} control grid</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
