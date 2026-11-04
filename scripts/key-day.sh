#!/usr/bin/env bash
# First run with a Meta Model API key: prove every model live, rescore the
# source screen, then start the local stack for one real job.
#   ./scripts/key-day.sh            # probe + eval, then start the stack
#   ./scripts/key-day.sh --no-stack # probe + eval only
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]] || ! grep -q '^MODEL_API_KEY=.' .env.local; then
  echo "add MODEL_API_KEY=... to .env.local first" >&2
  exit 2
fi
set -a; source .env.local; set +a

echo "== 1/3 Live call to every Meta model =="
(cd agent && .venv/bin/python -m harmonia_agent.meta_probe --out ../evidence/meta-probe.json) || echo "probe reported failures; see evidence/meta-probe.json"

echo "== 2/3 Source screen eval =="
if curl -sf http://localhost:11434/api/version >/dev/null; then
  export GLIMMER_BASE_URL="${GLIMMER_BASE_URL:-http://localhost:11434/v1}"
fi
(cd agent && .venv/bin/python -m harmonia_agent.source_guard_eval --out ../evidence/source-screen-eval.json >/dev/null)

[[ "${1:-}" == "--no-stack" ]] && exit 0

cat <<'NEXT'
== 3/3 Local stack for one real job ==
Sign-in uses the local development session (emulators only). When the job you
want to show is done, export and publish it:

  FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GOOGLE_CLOUD_PROJECT=harmonia-local \
    npx tsx scripts/export-job-run.ts --job <job id> --output ../harmonia-private/run.json --authorize-source
  npx tsx scripts/approve-replay.ts --input ../harmonia-private/run.json

NEXT
HARMONIA_DEV_AUTH_BYPASS=1 exec ./scripts/dev.sh
