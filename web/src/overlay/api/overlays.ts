import { apiBase, apiGet } from "../../map/api/client";
import type { OverlayAssetUpload, OverlayProject, OverlayProjectInput, OverlayProjectList } from "../../types/models";

export function listOverlayProjects() {
  return apiGet<OverlayProjectList>("/overlay-projects");
}

export function getOverlayProject(id: string) {
  return apiGet<OverlayProject>(`/overlay-projects/${id}`);
}

export async function saveOverlayProject(input: OverlayProjectInput) {
  const res = await fetch(`${apiBase()}/overlay-projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as OverlayProject;
}

export async function uploadOverlayAsset(file: File) {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const encoded = result.includes(",") ? result.split(",")[1] : "";
      resolve(encoded);
    };
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${apiBase()}/overlay-assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      mime: file.type,
      content_base64: contentBase64
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as OverlayAssetUpload;
}

export function overlayAssetUrl(assetPath: string) {
  return `${apiBase()}${assetPath}`;
}
