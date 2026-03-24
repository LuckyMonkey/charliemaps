import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type OverlayPoint = {
  lat: number;
  lng: number;
};

export type OverlayProject = {
  id: string;
  name: string;
  asset_path: string;
  image_width: number;
  image_height: number;
  rows: number;
  cols: number;
  opacity: number;
  points: OverlayPoint[];
  created_at: string;
  updated_at: string;
};

export type OverlayProjectInput = Omit<OverlayProject, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

function overlaysDir(dataDir: string) {
  return path.join(dataDir, "overlays");
}

function assetsDir(dataDir: string) {
  return path.join(overlaysDir(dataDir), "assets");
}

function projectsDir(dataDir: string) {
  return path.join(overlaysDir(dataDir), "projects");
}

function projectPath(dataDir: string, id: string) {
  return path.join(projectsDir(dataDir), `${id}.json`);
}

function assetFileName(originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  return `${randomUUID()}${ext}`;
}

export async function ensureOverlayDirs(dataDir: string) {
  await fs.mkdir(assetsDir(dataDir), { recursive: true });
  await fs.mkdir(projectsDir(dataDir), { recursive: true });
}

export async function listOverlayProjects(dataDir: string) {
  await ensureOverlayDirs(dataDir);
  const entries = await fs.readdir(projectsDir(dataDir));
  const items = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const raw = await fs.readFile(path.join(projectsDir(dataDir), entry), "utf8");
        return JSON.parse(raw) as OverlayProject;
      })
  );
  return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getOverlayProject(dataDir: string, id: string) {
  const raw = await fs.readFile(projectPath(dataDir, id), "utf8");
  return JSON.parse(raw) as OverlayProject;
}

export async function saveOverlayProject(dataDir: string, input: OverlayProjectInput) {
  await ensureOverlayDirs(dataDir);
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  let createdAt = now;

  try {
    const existing = await getOverlayProject(dataDir, id);
    createdAt = existing.created_at;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  const project: OverlayProject = {
    ...input,
    id,
    created_at: createdAt,
    updated_at: now
  };

  await fs.writeFile(projectPath(dataDir, id), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  return project;
}

export async function saveOverlayAsset(dataDir: string, originalName: string, buffer: Buffer) {
  await ensureOverlayDirs(dataDir);
  const fileName = assetFileName(originalName);
  await fs.writeFile(path.join(assetsDir(dataDir), fileName), buffer);
  return {
    file_name: fileName,
    asset_path: `/overlay-assets/${fileName}`
  };
}

export function resolveOverlayAssetPath(dataDir: string, fileName: string) {
  return path.join(assetsDir(dataDir), path.basename(fileName));
}
