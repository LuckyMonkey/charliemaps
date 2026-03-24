#!/usr/bin/env bash
set -euo pipefail

REMOTE="${GDRIVE_REMOTE:-}"
DEST="${GDRIVE_DEST:-/home/fridge/photo-imports/gdrive}"
EXTRA_ARGS="${RCLONE_EXTRA_ARGS:-}"

if [[ -z "${REMOTE}" ]]; then
  echo "Set GDRIVE_REMOTE to an rclone remote or remote path, for example gdrivephotos:Photos" >&2
  exit 1
fi

mkdir -p "${DEST}"

echo "Syncing Google Drive photos from ${REMOTE} to ${DEST}"
rclone sync "${REMOTE}" "${DEST}" \
  --create-empty-src-dirs \
  --copy-links \
  --fast-list \
  ${EXTRA_ARGS}
