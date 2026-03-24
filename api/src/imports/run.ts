import fs from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import { createHash, randomUUID } from "node:crypto";
import { defaultImportConfigPath, defaultImportOutputDir, loadImportSources, type ImportSource } from "./config.js";

type ImportPhotoRecord = {
  id: string;
  source_key: string;
  source_label: string;
  file_path: string;
  relative_path: string;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  has_gps: boolean;
  exif: Record<string, unknown>;
};

type ImportLayerPoint = {
  id: string;
  source_key: string;
  source_label: string;
  file_path: string;
  relative_path: string;
  taken_at: string | null;
  lat: number;
  lng: number;
  weight: number;
};

type SourceStats = {
  key: string;
  label: string;
  root_path: string;
  scanned: number;
  with_gps: number;
  without_gps: number;
  errors: number;
};

type PhotoCatalog = {
  type: "photo-catalog";
  generated_at: string;
  sources: SourceStats[];
  photos: ImportPhotoRecord[];
};

type PhotoLayer = {
  type: "photo-layer";
  generated_at: string;
  points: ImportLayerPoint[];
  bbox: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null;
};

const SUPPORTED_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"]);

function parseArgs(argv: string[]) {
  const args = { config: defaultImportConfigPath(), outDir: defaultImportOutputDir() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--config" && argv[i + 1]) {
      args.config = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--out-dir" && argv[i + 1]) {
      args.outDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function walkFiles(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith("._")) continue;
    const abs = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)));
      continue;
    }
    if (entry.isFile() && SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(abs);
    }
  }
  return out;
}

function toIsoString(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  return null;
}

function pointId(sourceKey: string, relativePath: string) {
  return createHash("sha1").update(`${sourceKey}:${relativePath}`).digest("hex");
}

function buildBbox(points: ImportLayerPoint[]) {
  if (!points.length) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLat = Math.max(maxLat, point.lat);
    maxLng = Math.max(maxLng, point.lng);
  }
  return { minLat, minLng, maxLat, maxLng };
}

async function scanSource(source: ImportSource) {
  const stats: SourceStats = {
    key: source.key,
    label: source.label,
    root_path: source.root_path,
    scanned: 0,
    with_gps: 0,
    without_gps: 0,
    errors: 0
  };
  const records: ImportPhotoRecord[] = [];
  let files: string[] = [];

  try {
    files = await walkFiles(source.root_path);
  } catch (err) {
    stats.errors += 1;
    console.warn(`import skip source ${source.root_path}:`, err);
    return { stats, records };
  }

  for (const filePath of files) {
    stats.scanned += 1;
    const relativePath = path.relative(source.root_path, filePath);
    try {
      const exif = (await exifr.parse(filePath, {
        gps: true,
        tiff: true,
        exif: true,
        xmp: true
      })) ?? {};

      const lat = typeof exif.latitude === "number" ? exif.latitude : null;
      const lng = typeof exif.longitude === "number" ? exif.longitude : null;
      const hasGps = lat !== null && lng !== null;
      if (hasGps) stats.with_gps += 1;
      else stats.without_gps += 1;

      records.push({
        id: pointId(source.key, relativePath) || randomUUID(),
        source_key: source.key,
        source_label: source.label,
        file_path: filePath,
        relative_path: relativePath,
        taken_at: toIsoString(exif.DateTimeOriginal) ?? toIsoString(exif.CreateDate),
        lat,
        lng,
        has_gps: hasGps,
        exif: exif as Record<string, unknown>
      });
    } catch (err) {
      stats.errors += 1;
      console.warn(`import skip ${filePath}:`, err);
    }
  }

  return { stats, records };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = await loadImportSources(args.config);
  const generatedAt = new Date().toISOString();
  const stats: SourceStats[] = [];
  const records: ImportPhotoRecord[] = [];

  for (const source of sources) {
    const scanned = await scanSource(source);
    stats.push(scanned.stats);
    records.push(...scanned.records);
  }

  const points: ImportLayerPoint[] = records
    .filter((record) => record.has_gps && record.lat !== null && record.lng !== null)
    .map((record) => ({
      id: record.id,
      source_key: record.source_key,
      source_label: record.source_label,
      file_path: record.file_path,
      relative_path: record.relative_path,
      taken_at: record.taken_at,
      lat: record.lat as number,
      lng: record.lng as number,
      weight: 1
    }));

  const catalog: PhotoCatalog = {
    type: "photo-catalog",
    generated_at: generatedAt,
    sources: stats,
    photos: records
  };

  const layer: PhotoLayer = {
    type: "photo-layer",
    generated_at: generatedAt,
    points,
    bbox: buildBbox(points)
  };

  await fs.mkdir(args.outDir, { recursive: true });
  await fs.writeFile(path.join(args.outDir, "photo-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(args.outDir, "photo-layer.json"), `${JSON.stringify(layer, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        config: args.config,
        out_dir: args.outDir,
        sources: stats,
        total_photos: records.length,
        layer_points: points.length,
        generated_at: generatedAt
      },
      null,
      2
    )
  );
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
