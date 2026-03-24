import { MapShell } from "../map/MapShell";
import { routes } from "./routes";
import { useRoute } from "./useRoute";
import { OverlayEditorPage } from "../overlay/OverlayEditorPage";

export function App() {
  const { route } = useRoute();
  return route === routes.overlays ? <OverlayEditorPage /> : <MapShell />;
}
