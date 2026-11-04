#!/usr/bin/env bash
# Record what a workspace agent token can and cannot do against a running
# Harmonia (default http://localhost:3000, development session for minting).
#   ./scripts/prove-agent-authority.sh [base-url] > evidence/agent-authority.json
set -euo pipefail
BASE="${1:-http://localhost:3000}"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
curl -sf -c "$JAR" -X POST "$BASE/api/auth/session" -H 'content-type: application/json' -d '{"devBypass":true}' >/dev/null
TOKEN="$(curl -sf -b "$JAR" -X POST "$BASE/api/settings/agent-tokens" -H 'content-type: application/json' -d '{"label":"authority proof"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')"
JOB="$(curl -sf -H "authorization: Bearer $TOKEN" "$BASE/api/jobs" | python3 -c 'import json,sys;j=json.load(sys.stdin)["jobs"];print(j[0]["id"] if j else "none")')"
DIGEST="$(printf 'a%.0s' $(seq 1 64))"
probe() { # method path [body]
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE$2" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' ${3:+-d "$3"})"
  printf '{"method":"%s","route":"%s","status":%s}' "$1" "${2//$JOB/<job>}" "$code"
}
echo "{"
echo "  \"proof\": \"harmonia-agent-token-authority\","
echo "  \"ranAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
echo "  \"allowed\": ["
echo "    $(probe GET /api/jobs),"
echo "    $(probe GET /api/jobs/$JOB),"
echo "    $(probe POST /api/a2a '{"jsonrpc":"2.0","id":1,"method":"tasks/get","params":{"id":"'"$JOB"'"}}')"
echo "  ],"
echo "  \"refused\": ["
echo "    $(probe POST /api/jobs/$JOB/strategy/decision '{"decision":"approved","payloadDigest":"'"$DIGEST"'"}'),"
echo "    $(probe POST /api/jobs/$JOB/actions/any/decision '{"decision":"approved","payloadDigest":"'"$DIGEST"'"}'),"
echo "    $(probe POST /api/proposals/decide '{}'),"
echo "    $(probe POST /api/jobs/$JOB/retry '{"afterFix":true}'),"
echo "    $(probe POST /api/settings/agent-tokens '{"label":"escalate"}')"
echo "  ]"
echo "}"
