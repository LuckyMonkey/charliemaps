import fs from "node:fs/promises";
import path from "node:path";

export type ImportSource = {
  key: string;
  label: string;
  root_path: string;
  enabled: boolean;
};

type ImportConfigFile = {
  sources?: Array<{
    key?: string;
    label?: string;
    root_path?: string;
    enabled?: boolean;
  }>;
};

export function defaultImportConfigPath() {
  return path.resolve(process.cwd(), "..", "data", "import-sources.json");
}

export function defaultImportOutputDir() {
  return path.resolve(process.cwd(), "..", "data", "imports");
}

export async function loadImportSources(configPath = defaultImportConfigPath()) {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as ImportConfigFile;
  const sources = (parsed.sources ?? [])
    .map((source) => ({
      key: String(source.key ?? "").trim(),
      label: String(source.label ?? "").trim(),
      root_path: String(source.root_path ?? "").trim(),
      enabled: source.enabled !== false
    }))
    .filter((source) => source.key && source.label && source.root_path && source.enabled);

  if (!sources.length) {
    throw new Error(`No enabled import sources found in ${configPath}`);
  }

  return sources satisfies ImportSource[];
}

