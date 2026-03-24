#!/usr/bin/env bash
set -euo pipefail

APPLE_ID="${APPLE_ID:-}"
DEST="${ICLOUD_DEST:-/home/fridge/photo-imports/icloud}"
COOKIE_DIR="${ICLOUD_COOKIE_DIR:-/home/fridge/.config/icloudpd}"
ICLOUDPD_BIN="${ICLOUDPD_BIN:-/home/fridge/.local/bin/icloudpd}"

if [[ -z "${APPLE_ID}" ]]; then
  echo "Set APPLE_ID to your iCloud login email before running this script" >&2
  exit 1
fi

if [[ ! -x "${ICLOUDPD_BIN}" ]]; then
  echo "icloudpd is not installed at ${ICLOUDPD_BIN}" >&2
  exit 1
fi

mkdir -p "${DEST}" "${COOKIE_DIR}"

echo "Syncing iCloud Photos into ${DEST}"
"${ICLOUDPD_BIN}" \
  --directory "${DEST}" \
  --username "${APPLE_ID}" \
  --cookie-directory "${COOKIE_DIR}" \
  --size original \
  --folder-structure "{:%Y/%m}"
