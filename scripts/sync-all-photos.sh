#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${GDRIVE_REMOTE:-}" ]]; then
  "${REPO_ROOT}/scripts/sync-gdrive.sh"
else
  echo "Skipping Google Drive sync because GDRIVE_REMOTE is not set"
fi

if [[ -n "${ONEDRIVE_REMOTE:-}" ]]; then
  "${REPO_ROOT}/scripts/sync-onedrive.sh"
else
  echo "Skipping OneDrive sync because ONEDRIVE_REMOTE is not set"
fi

if [[ -n "${APPLE_ID:-}" ]]; then
  "${REPO_ROOT}/scripts/sync-icloud.sh"
else
  echo "Skipping iCloud sync because APPLE_ID is not set"
fi

"${REPO_ROOT}/scripts/import-photos.sh"
