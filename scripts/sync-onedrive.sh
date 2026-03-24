#!/usr/bin/env bash
set -euo pipefail

REMOTE="${ONEDRIVE_REMOTE:-}"
DEST="${ONEDRIVE_DEST:-/home/fridge/photo-imports/onedrive}"
EXTRA_ARGS="${RCLONE_EXTRA_ARGS:-}"

if [[ -z "${REMOTE}" ]]; then
  echo "Set ONEDRIVE_REMOTE to an rclone remote or remote path, for example onedrivephotos:Pictures" >&2
  exit 1
fi

mkdir -p "${DEST}"

echo "Syncing OneDrive photos from ${REMOTE} to ${DEST}"
rclone sync "${REMOTE}" "${DEST}" \
  --create-empty-src-dirs \
  --copy-links \
  --fast-list \
  ${EXTRA_ARGS}
