#!/usr/bin/env bash
set -euo pipefail

readonly output_dir="${1:-.artifacts/sbom}"
mkdir -p "$output_dir"

npm sbom --sbom-format cyclonedx --package-lock-only --omit=dev >"$output_dir/node.cdx.json"
node scripts/python-lock-sbom.mjs agent/requirements.lock >"$output_dir/python.cdx.json"

# IMAGE_REF must name an image that was actually built. Omitting it creates
# source dependency inventories only; it never fabricates an OS/image result.
if [[ -n "${IMAGE_REF:-}" ]]; then
  docker scout sbom --format cyclonedx "${IMAGE_REF}" >"$output_dir/image.cdx.json"
else
  echo "IMAGE_REF not set; image and OS inventory not generated" >&2
fi
