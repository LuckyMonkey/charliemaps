#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${REPO_ROOT}/api"
CONFIG_PATH="${IMPORT_CONFIG_PATH:-${REPO_ROOT}/data/import-sources.json}"
OUT_DIR="${IMPORT_OUT_DIR:-${REPO_ROOT}/data/imports}"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "Missing import config at ${CONFIG_PATH}. Copy data/import-sources.example.json first." >&2
  exit 1
fi

cd "${API_DIR}"
npm run build >/dev/null
node dist/imports/run.js --config "${CONFIG_PATH}" --out-dir "${OUT_DIR}" "$@"
