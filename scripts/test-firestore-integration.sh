#!/usr/bin/env bash
set -euo pipefail

readonly integration_host="127.0.0.1:8086"
readonly integration_project="harmonia-integration-test"
readonly emulator_log="$(mktemp -t harmonia-firestore-emulator.XXXXXX)"
emulator_pid=""

cleanup() {
  if [[ -n "$emulator_pid" ]] && kill -0 "$emulator_pid" 2>/dev/null; then
    kill "$emulator_pid"
    wait "$emulator_pid" 2>/dev/null || true
  fi
  rm -f "$emulator_log"
}
trap cleanup EXIT INT TERM

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required to run the Firestore integration suite" >&2
  exit 1
fi

if ! java -version >/dev/null 2>&1; then
  for java_home_candidate in \
    /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home; do
    if [[ -x "$java_home_candidate/bin/java" ]]; then
      export JAVA_HOME="$java_home_candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi
if ! java -version >/dev/null 2>&1; then
  echo "Java 8 or newer is required to run the Firestore emulator" >&2
  exit 1
fi

gcloud beta emulators firestore start \
  --host-port "$integration_host" \
  --project "$integration_project" >"$emulator_log" 2>&1 &
emulator_pid="$!"

ready="false"
for _attempt in {1..60}; do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    cat "$emulator_log" >&2
    exit 1
  fi
  if curl --silent --fail "http://$integration_host/" >/dev/null 2>&1; then
    ready="true"
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  cat "$emulator_log" >&2
  echo "Firestore emulator did not become ready" >&2
  exit 1
fi

export FIRESTORE_EMULATOR_HOST="$integration_host"
export GOOGLE_CLOUD_PROJECT="$integration_project"
npx vitest run tests/*Firestore.integration.test.ts tests/durableRuntimeObservability.integration.test.ts
