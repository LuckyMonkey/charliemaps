import { useEffect, useMemo, useState } from "react";
import { latLngBounds, type LatLngBounds, type Map as LeafletMap } from "leaflet";
import { getOverlayProject, listOverlayProjects, saveOverlayProject, uploadOverlayAsset } from "../api/overlays";
import type { OverlayProject, OverlayProjectInput } from "../../types/models";
import { buildDefaultOverlayPoints } from "../../utils/overlayWarp";

const FALLBACK_BOUNDS = latLngBounds([42.33, -71.12], [42.4, -71.0]);

async function imageSize(file: File) {
  const src = URL.createObjectURL(file);
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not read image dimensions"));
      img.src = src;
    });
    return size;
  } finally {
    URL.revokeObjectURL(src);
  }
}

function defaultProjectInput(fileName: string, assetPath: string, width: number, height: number, bounds: LatLngBounds): OverlayProjectInput {
  const rows = 4;
  const cols = 4;
  return {
    name: fileName.replace(/\.[^.]+$/, "") || "New overlay",
    asset_path: assetPath,
    image_width: width,
    image_height: height,
    rows,
    cols,
    opacity: 0.72,
    points: buildDefaultOverlayPoints(bounds.pad(-0.2), rows, cols)
  };
}

export function useOverlayEditor() {
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [projects, setProjects] = useState<OverlayProject[]>([]);
  const [project, setProject] = useState<OverlayProject | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await listOverlayProjects();
        setProjects(res.items);
        if (res.items[0]) {
          setProject(await getOverlayProject(res.items[0].id));
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const refreshProjects = async (activeId?: string) => {
    const res = await listOverlayProjects();
    setProjects(res.items);
    if (activeId) {
      const next = await getOverlayProject(activeId);
      setProject(next);
    }
  };

  const onUpload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const [asset, size] = await Promise.all([uploadOverlayAsset(file), imageSize(file)]);
      const input = defaultProjectInput(file.name, asset.asset_path, size.width, size.height, map?.getBounds() ?? FALLBACK_BOUNDS);
      const saved = await saveOverlayProject(input);
      await refreshProjects(saved.id);
      setNotice(`Loaded ${file.name}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSelectProject = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      setProject(await getOverlayProject(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updatePoint = (index: number, lat: number, lng: number) => {
    setProject((current) =>
      current
        ? {
            ...current,
            points: current.points.map((point, i) => (i === index ? { lat, lng } : point))
          }
        : current
    );
  };

  const save = async () => {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      const saved = await saveOverlayProject(project);
      setProject(saved);
      await refreshProjects(saved.id);
      setNotice(`Saved ${saved.name}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inspector = useMemo(
    () => ({
      project,
      busy,
      onNameChange: (name: string) => setProject((current) => (current ? { ...current, name } : current)),
      onOpacityChange: (opacity: number) => setProject((current) => (current ? { ...current, opacity } : current)),
      onSave: save
    }),
    [project, busy]
  );

  const sidebar = useMemo(
    () => ({
      busy,
      projects,
      activeId: project?.id ?? "",
      onSelectProject,
      onUpload
    }),
    [busy, projects, project]
  );

  return { project, setMap, updatePoint, sidebar, inspector, error, notice };
}
