import { OverlayEditorMap } from "./OverlayEditorMap";
import { useOverlayEditor } from "./state/useOverlayEditor";
import { OverlaySidebar } from "./ui/OverlaySidebar";
import { OverlayInspector } from "./ui/OverlayInspector";

export function OverlayEditorPage() {
  const editor = useOverlayEditor();

  return (
    <div className="editor-layout">
      <OverlaySidebar {...editor.sidebar} />
      <div className="editor-map-wrap">
        <OverlayEditorMap
          project={editor.project}
          onMapReady={editor.setMap}
          onUpdatePoint={editor.updatePoint}
        />
      </div>
      <OverlayInspector {...editor.inspector} />
      {editor.error ? <div className="status error">{editor.error}</div> : null}
      {editor.notice ? <div className="status">{editor.notice}</div> : null}
    </div>
  );
}
