#!/usr/bin/env bash
# Deploys the Harmonia web + ADK agent services to Cloud Run and wires the
# Pub/Sub push subscription. Idempotent; re-runs create new revisions.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
MODEL_ID="${MODEL_ID:-muse-spark-1.3}"
META_API_BASE_URL="${META_API_BASE_URL:-https://api.meta.ai/v1}"
COORDINATOR_MODEL_ID="${COORDINATOR_MODEL_ID:-muse-spark-1.3}"
STRATEGIST_MODEL_ID="${STRATEGIST_MODEL_ID:-muse-spark-1.3}"
ANALYST_MODEL_ID="${ANALYST_MODEL_ID:-muse-spark-1.3}"
COPYWRITER_MODEL_ID="${COPYWRITER_MODEL_ID:-muse-spark-1.3}"
EDITOR_MODEL_ID="${EDITOR_MODEL_ID:-muse-spark-1.3}"
PLANNER_MODEL_ID="${PLANNER_MODEL_ID:-muse-spark-1.3}"
PRESENTER_MODEL_ID="${PRESENTER_MODEL_ID:-muse-spark-1.3}"
MODEL_PRICING_VERSION="${MODEL_PRICING_VERSION:-2026-11-03}"
DEFAULT_JOB_BUDGET_USD="${DEFAULT_JOB_BUDGET_USD:-5.00}"
DEFAULT_JOB_APPROVAL_THRESHOLD_USD="${DEFAULT_JOB_APPROVAL_THRESHOLD_USD:-0.25}"
IMAGE_MAX_COST_USD="${IMAGE_MAX_COST_USD:-0.500000}"
DEFAULT_WORKSPACE_BUDGET_USD="${DEFAULT_WORKSPACE_BUDGET_USD:-100.00}"
AGENT_ENGINE_RESOURCE="${AGENT_ENGINE_RESOURCE:?set AGENT_ENGINE_RESOURCE to the deployed reasoning engine resource}"
MEMORY_BANK_ENABLED="true"
MEMORY_BANK_RESOURCE="${MEMORY_BANK_RESOURCE:-${AGENT_ENGINE_RESOURCE}}"
GENERATIVE_MEDIA_ENABLED="${GENERATIVE_MEDIA_ENABLED:-false}"
ALLOW_GLOBAL_LYRIA="${ALLOW_GLOBAL_LYRIA:-false}"
VERTEX_MEDIA_LOCATION="${VERTEX_MEDIA_LOCATION:-${REGION}}"
LYRIA_3_CLIP_COST_USD="${LYRIA_3_CLIP_COST_USD:-}"
LYRIA_3_PRO_COST_USD="${LYRIA_3_PRO_COST_USD:-}"
VEO_3_1_COST_PER_SECOND_USD="${VEO_3_1_COST_PER_SECOND_USD:-}"
FIREBASE_API_KEY="${FIREBASE_API_KEY:?set FIREBASE_API_KEY for Identity Platform web sign-in}"
FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-${PROJECT_ID}.firebaseapp.com}"
FIREBASE_APP_ID="${FIREBASE_APP_ID:?set FIREBASE_APP_ID for the registered web application}"
GCS_BUCKET="${GCS_BUCKET:-${PROJECT_ID}-harmonia-assets}"
APP_URL="${APP_URL:-https://useharmonia.xyz}"
GOOGLE_CSE_ID="${GOOGLE_CSE_ID:-}"
DURABLE_RECOVERY_LIMIT="${DURABLE_RECOVERY_LIMIT:-20}"
DURABLE_RECOVERY_DEADLINE_SECONDS="${DURABLE_RECOVERY_DEADLINE_SECONDS:-15}"
DURABLE_RECOVERY_MAX_RETRIES="${DURABLE_RECOVERY_MAX_RETRIES:-3}"
DURABLE_RECOVERY_MAX_COST_USD="${DURABLE_RECOVERY_MAX_COST_USD:-0.250000}"
SOURCE_COMMIT="$(git rev-parse HEAD)"
IMAGE_REPOSITORY="${REGION}-docker.pkg.dev/${PROJECT_ID}/harmonia"

resource_location() {
  local resource="$1"
  if [[ "${resource}" =~ /locations/([^/]+)/ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return
  fi
  echo "resource has no /locations/<region>/ segment: ${resource}" >&2
  exit 2
}

require_region() {
  local label="$1"
  local resource="$2"
  local actual
  actual="$(resource_location "${resource}")"
  if [[ "${actual}" != "${REGION}" ]]; then
    echo "${label} is in ${actual}; required residency region is ${REGION}" >&2
    exit 2
  fi
}

require_region "Agent Engine" "${AGENT_ENGINE_RESOURCE}"
require_region "Memory Bank" "${MEMORY_BANK_RESOURCE}"
if [[ "${VERTEX_MEDIA_LOCATION}" != "${REGION}" ]]; then
  echo "Vertex media is in ${VERTEX_MEDIA_LOCATION}; required residency region is ${REGION}" >&2
  exit 2
fi
if [[ "${GENERATIVE_MEDIA_ENABLED}" == "true" && "${ALLOW_GLOBAL_LYRIA}" != "true" ]]; then
  echo "generative media includes global Lyria; set ALLOW_GLOBAL_LYRIA=true only after an approved residency-policy exception" >&2
  exit 2
fi
if [[ "${GENERATIVE_MEDIA_ENABLED}" == "true" && -z "${LYRIA_3_CLIP_COST_USD}" ]]; then
  echo "LYRIA_3_CLIP_COST_USD must be configured before enabling paid preview generation" >&2
  exit 1
fi

if [[ -z "${MEMORY_BANK_RESOURCE}" ]]; then
  echo "MEMORY_BANK_RESOURCE is required when MEMORY_BANK_ENABLED=true" >&2
  exit 2
fi

gcloud config set project "${PROJECT_ID}"

# Only mount secrets that exist so optional integrations never block deploys.
secret_exists() {
  gcloud secrets describe "$1" --project "${PROJECT_ID}" >/dev/null 2>&1
}

record_release_identity() {
  local service="$1"
  local revision image_identity digest source_commit
  revision="$(gcloud run services describe "${service}" --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.latestReadyRevisionName)')"
  image_identity="$(gcloud run revisions describe "${revision}" --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.imageDigest)')"
  digest="${image_identity##*@}"
  if [[ -z "${revision}" || ! "${digest}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "could not resolve immutable release identity for ${service}" >&2
    exit 2
  fi
  source_commit="$(git rev-parse HEAD 2>/dev/null || printf unknown)"
  echo "RELEASE_IDENTITY service=${service} revision=${revision} imageDigest=${digest} sourceCommit=${source_commit}"
}

resolve_built_image_digest() {
  local image_tag="$1"
  local digest
  digest="$(gcloud artifacts docker images describe "${image_tag}" --project "${PROJECT_ID}" --format 'value(image_summary.digest)')"
  if [[ ! "${digest}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "could not resolve built image digest for ${image_tag}" >&2
    exit 2
  fi
  printf '%s' "${digest}"
}

if ! secret_exists malware-scanner-token; then
  echo "required upload scanner secret 'malware-scanner-token' not found; run infra/setup.sh" >&2
  exit 2
fi

echo "== Deploying authenticated ClamAV scanner =="
SCANNER_IMAGE_TAG="${IMAGE_REPOSITORY}/harmonia-malware-scanner:${SOURCE_COMMIT}"
gcloud builds submit . \
  --config cloudbuild.scanner.yaml \
  --substitutions "_IMAGE=${SCANNER_IMAGE_TAG}" \
  --project "${PROJECT_ID}"
SCANNER_IMAGE_DIGEST="$(resolve_built_image_digest "${SCANNER_IMAGE_TAG}")"
gcloud run deploy harmonia-malware-scanner \
  --image "${SCANNER_IMAGE_TAG}@${SCANNER_IMAGE_DIGEST}" \
  --region "${REGION}" \
  --service-account "harmonia-malware-scanner@${PROJECT_ID}.iam.gserviceaccount.com" \
  --no-allow-unauthenticated \
  --min-instances 0 --max-instances 2 \
  --memory 2Gi --cpu 1 --timeout 60 \
  --set-secrets "MALWARE_SCANNER_TOKEN=malware-scanner-token:latest" \
  --project "${PROJECT_ID}"
record_release_identity harmonia-malware-scanner
SCANNER_URL="$(gcloud run services describe harmonia-malware-scanner --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)')"
gcloud run services add-iam-policy-binding harmonia-malware-scanner \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/run.invoker

WEB_SECRETS="INTERNAL_API_TOKEN=internal-api-token:latest"
if secret_exists model-api-key; then
  WEB_SECRETS="${WEB_SECRETS},MODEL_API_KEY=model-api-key:latest"
fi
for pair in GOOGLE_CLIENT_ID:google-oauth-client-id GOOGLE_CLIENT_SECRET:google-oauth-client-secret; do
  env_name="${pair%%:*}"; secret_name="${pair##*:}"
  if ! secret_exists "${secret_name}"; then
    echo "required Google OAuth secret '${secret_name}' not found; run infra/setup.sh with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" >&2
    exit 2
  fi
  WEB_SECRETS="${WEB_SECRETS},${env_name}=${secret_name}:latest"
done
if ! secret_exists harmonia-connection-envelope-key; then
  echo "required connection envelope secret 'harmonia-connection-envelope-key' not found; run infra/setup.sh with HARMONIA_CONNECTION_ENVELOPE_KEY" >&2
  exit 2
fi
WEB_SECRETS="${WEB_SECRETS},HARMONIA_CONNECTION_ENVELOPE_KEY=harmonia-connection-envelope-key:latest"
if secret_exists x-oauth-client-id || secret_exists x-oauth-client-secret; then
  for pair in X_CLIENT_ID:x-oauth-client-id X_CLIENT_SECRET:x-oauth-client-secret; do
    env_name="${pair%%:*}"; secret_name="${pair##*:}"
    if ! secret_exists "${secret_name}"; then
      echo "incomplete X OAuth secret pair; missing '${secret_name}'" >&2
      exit 2
    fi
    WEB_SECRETS="${WEB_SECRETS},${env_name}=${secret_name}:latest"
  done
fi
WEB_ENV="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GCS_BUCKET=${GCS_BUCKET},PUBSUB_DATA_TOPIC=harmonia-data-work,PUBSUB_PRODUCTION_TOPIC=harmonia-production,MODEL_ID=${MODEL_ID},META_API_BASE_URL=${META_API_BASE_URL},MODEL_PRICING_VERSION=${MODEL_PRICING_VERSION},LYRIA_3_CLIP_COST_USD=${LYRIA_3_CLIP_COST_USD},VEO_3_1_COST_PER_SECOND_USD=${VEO_3_1_COST_PER_SECOND_USD},DEFAULT_JOB_BUDGET_USD=${DEFAULT_JOB_BUDGET_USD},DEFAULT_JOB_APPROVAL_THRESHOLD_USD=${DEFAULT_JOB_APPROVAL_THRESHOLD_USD},DEFAULT_WORKSPACE_BUDGET_USD=${DEFAULT_WORKSPACE_BUDGET_USD},HARMONIA_TELEMETRY_ENABLED=1,HARMONIA_TELEMETRY_SAMPLE_RATE=1.0,OTEL_SERVICE_NAME=harmonia-web,OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=NO_CONTENT,ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false,MALWARE_SCANNER_URL=${SCANNER_URL}/scan"
WEB_SECRETS="${WEB_SECRETS},MALWARE_SCANNER_TOKEN=malware-scanner-token:latest"

echo "== Deploying harmonia-web (Next.js) =="
WEB_IMAGE_TAG="${IMAGE_REPOSITORY}/harmonia-web:${SOURCE_COMMIT}"
gcloud builds submit . \
  --config cloudbuild.web.yaml \
  --substitutions "_IMAGE=${WEB_IMAGE_TAG},_FIREBASE_API_KEY=${FIREBASE_API_KEY},_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN},_FIREBASE_APP_ID=${FIREBASE_APP_ID}" \
  --project "${PROJECT_ID}"
WEB_IMAGE_DIGEST="$(resolve_built_image_digest "${WEB_IMAGE_TAG}")"
gcloud run deploy harmonia-web \
  --image "${WEB_IMAGE_TAG}@${WEB_IMAGE_DIGEST}" \
  --region "${REGION}" \
  --service-account "harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 2 \
  --set-env-vars "${WEB_ENV}" \
  --set-secrets "${WEB_SECRETS}" \
  --project "${PROJECT_ID}"
record_release_identity harmonia-web

WEB_URL="$(gcloud run services describe harmonia-web --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)')"
echo "web: ${WEB_URL}"

CORS_FILE="$(mktemp)"
trap 'rm -f "${CORS_FILE}"' EXIT
printf '[{"origin":["%s","%s"],"method":["GET","HEAD","PUT"],"responseHeader":["Content-Type","Range","x-goog-resumable"],"maxAgeSeconds":3600}]' \
  "${APP_URL}" "${WEB_URL}" > "${CORS_FILE}"
gcloud storage buckets update "gs://${GCS_BUCKET}" \
  --cors-file="${CORS_FILE}" --project "${PROJECT_ID}"

AGENT_SECRETS="INTERNAL_API_TOKEN=internal-api-token:latest"
for pair in MODEL_API_KEY:model-api-key YOUTUBE_API_KEY:youtube-api-key GOOGLE_CSE_API_KEY:google-cse-api-key; do
  env_name="${pair%%:*}"; secret_name="${pair##*:}"
  if secret_exists "${secret_name}"; then
    AGENT_SECRETS="${AGENT_SECRETS},${env_name}=${secret_name}:latest"
  else
    echo "  secret '${secret_name}' not found; ${env_name} left unset"
  fi
done
AGENT_ENV="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},WEB_INTERNAL_URL=${WEB_URL},GOOGLE_CSE_ID=${GOOGLE_CSE_ID},PUBSUB_STAGE_TOPIC=harmonia-stages,MODEL_ID=${MODEL_ID},META_API_BASE_URL=${META_API_BASE_URL},TRANSCRIBER_MODEL_ID=${TRANSCRIBER_MODEL_ID:-muse-voice-transcribe-1.0},IMAGE_MODEL_ID=${IMAGE_MODEL_ID:-muse-image-1.0},COORDINATOR_MODEL_ID=${COORDINATOR_MODEL_ID},STRATEGIST_MODEL_ID=${STRATEGIST_MODEL_ID},ANALYST_MODEL_ID=${ANALYST_MODEL_ID},COPYWRITER_MODEL_ID=${COPYWRITER_MODEL_ID},EDITOR_MODEL_ID=${EDITOR_MODEL_ID},PLANNER_MODEL_ID=${PLANNER_MODEL_ID},PRESENTER_MODEL_ID=${PRESENTER_MODEL_ID},MODEL_PRICING_VERSION=${MODEL_PRICING_VERSION},DEFAULT_JOB_BUDGET_USD=${DEFAULT_JOB_BUDGET_USD},DEFAULT_JOB_APPROVAL_THRESHOLD_USD=${DEFAULT_JOB_APPROVAL_THRESHOLD_USD},IMAGE_MAX_COST_USD=${IMAGE_MAX_COST_USD},AGENT_ENGINE_RESOURCE=${AGENT_ENGINE_RESOURCE},MEMORY_BANK_ENABLED=${MEMORY_BANK_ENABLED},MEMORY_BANK_RESOURCE=${MEMORY_BANK_RESOURCE},GENERATIVE_MEDIA_ENABLED=${GENERATIVE_MEDIA_ENABLED},ALLOW_GLOBAL_LYRIA=${ALLOW_GLOBAL_LYRIA},VERTEX_MEDIA_LOCATION=${VERTEX_MEDIA_LOCATION},LYRIA_3_CLIP_COST_USD=${LYRIA_3_CLIP_COST_USD},LYRIA_3_PRO_COST_USD=${LYRIA_3_PRO_COST_USD},VEO_3_1_COST_PER_SECOND_USD=${VEO_3_1_COST_PER_SECOND_USD},DURABLE_RECOVERY_LIMIT=${DURABLE_RECOVERY_LIMIT},DURABLE_RECOVERY_DEADLINE_SECONDS=${DURABLE_RECOVERY_DEADLINE_SECONDS},DURABLE_RECOVERY_MAX_RETRIES=${DURABLE_RECOVERY_MAX_RETRIES},DURABLE_RECOVERY_MAX_COST_USD=${DURABLE_RECOVERY_MAX_COST_USD},HARMONIA_TELEMETRY_ENABLED=1,HARMONIA_TELEMETRY_SAMPLE_RATE=1.0,OTEL_SERVICE_NAME=harmonia-agent,OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=NO_CONTENT,ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false"
AGENT_ENV="${AGENT_ENV},GCS_BUCKET=${GCS_BUCKET}"

echo "== Deploying harmonia-agent (Python ADK worker) =="
AGENT_IMAGE_TAG="${IMAGE_REPOSITORY}/harmonia-agent:${SOURCE_COMMIT}"
gcloud builds submit agent --tag "${AGENT_IMAGE_TAG}" --project "${PROJECT_ID}"
AGENT_IMAGE_DIGEST="$(resolve_built_image_digest "${AGENT_IMAGE_TAG}")"
gcloud run deploy harmonia-agent \
  --image "${AGENT_IMAGE_TAG}@${AGENT_IMAGE_DIGEST}" \
  --region "${REGION}" \
  --service-account "harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --no-allow-unauthenticated \
  --min-instances 1 --max-instances 1 --no-cpu-throttling \
  --timeout 1200 \
  --set-env-vars "${AGENT_ENV}" \
  --set-secrets "${AGENT_SECRETS}" \
  --project "${PROJECT_ID}"
record_release_identity harmonia-agent

AGENT_URL="$(gcloud run services describe harmonia-agent --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)')"
echo "agent: ${AGENT_URL}"

gcloud run services add-iam-policy-binding harmonia-agent \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/run.invoker >/dev/null

gcloud run services add-iam-policy-binding harmonia-agent \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/run.invoker >/dev/null

gcloud run services add-iam-policy-binding harmonia-agent \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/run.invoker >/dev/null

gcloud run services update harmonia-web \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --update-env-vars "^|^AGENT_SERVICE_URL=${AGENT_URL}|PUBLIC_BASE_URL=${APP_URL}|ATTACHMENT_ALLOWED_ORIGINS=${APP_URL},${WEB_URL}" >/dev/null

echo "== Wiring Pub/Sub push subscription =="
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format 'value(projectNumber)')"
gcloud pubsub topics add-iam-policy-binding harmonia-stages-dlq \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/pubsub.publisher --project "${PROJECT_ID}" >/dev/null
gcloud pubsub topics add-iam-policy-binding harmonia-production-dlq \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/pubsub.publisher --project "${PROJECT_ID}" >/dev/null

if gcloud pubsub subscriptions describe harmonia-stages-agent-push --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update harmonia-stages-agent-push \
    --push-endpoint "${AGENT_URL}/pubsub/push" \
    --push-auth-service-account "harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com" \
    --push-auth-token-audience "${AGENT_URL}/pubsub/push" \
    --ack-deadline 300 \
    --dead-letter-topic "projects/${PROJECT_ID}/topics/harmonia-stages-dlq" \
    --max-delivery-attempts 5 \
    --min-retry-delay 10s \
    --max-retry-delay 600s \
    --message-retention-duration 7d \
    --project "${PROJECT_ID}"
else
  gcloud pubsub subscriptions create harmonia-stages-agent-push \
    --topic harmonia-stages \
    --push-endpoint "${AGENT_URL}/pubsub/push" \
    --push-auth-service-account "harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com" \
    --push-auth-token-audience "${AGENT_URL}/pubsub/push" \
    --ack-deadline 300 \
    --dead-letter-topic "projects/${PROJECT_ID}/topics/harmonia-stages-dlq" \
    --max-delivery-attempts 5 \
    --min-retry-delay 10s \
    --max-retry-delay 600s \
    --message-retention-duration 7d \
    --project "${PROJECT_ID}"
fi

if gcloud pubsub subscriptions describe harmonia-production-agent-push --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update harmonia-production-agent-push \
    --push-endpoint "${AGENT_URL}/pubsub/production" \
    --push-auth-service-account "harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com" \
    --push-auth-token-audience "${AGENT_URL}/pubsub/production" \
    --ack-deadline 300 \
    --dead-letter-topic "projects/${PROJECT_ID}/topics/harmonia-production-dlq" \
    --max-delivery-attempts 5 \
    --min-retry-delay 10s \
    --max-retry-delay 600s \
    --message-retention-duration 7d \
    --project "${PROJECT_ID}"
else
  gcloud pubsub subscriptions create harmonia-production-agent-push \
    --topic harmonia-production \
    --push-endpoint "${AGENT_URL}/pubsub/production" \
    --push-auth-service-account "harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com" \
    --push-auth-token-audience "${AGENT_URL}/pubsub/production" \
    --ack-deadline 300 \
    --dead-letter-topic "projects/${PROJECT_ID}/topics/harmonia-production-dlq" \
    --max-delivery-attempts 5 \
    --min-retry-delay 10s \
    --max-retry-delay 600s \
    --message-retention-duration 7d \
    --project "${PROJECT_ID}"
fi

echo "== Wiring bounded durable recovery wake =="
RECOVERY_SCHEDULER_ARGS=(
  --location "${REGION}"
  --schedule "*/5 * * * *"
  --time-zone "Etc/UTC"
  --uri "${AGENT_URL}/durable/recover"
  --http-method POST
  --oidc-service-account-email "harmonia-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
  --oidc-token-audience "${AGENT_URL}"
  --attempt-deadline 60s
  --project "${PROJECT_ID}"
)
if gcloud scheduler jobs describe harmonia-durable-recovery --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http harmonia-durable-recovery "${RECOVERY_SCHEDULER_ARGS[@]}"
else
  gcloud scheduler jobs create http harmonia-durable-recovery "${RECOVERY_SCHEDULER_ARGS[@]}"
fi

gcloud pubsub subscriptions add-iam-policy-binding harmonia-stages-agent-push \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/pubsub.subscriber --project "${PROJECT_ID}" >/dev/null
gcloud pubsub subscriptions add-iam-policy-binding harmonia-production-agent-push \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/pubsub.subscriber --project "${PROJECT_ID}" >/dev/null

echo "== Wiring durable autonomy tick =="
SCHEDULER_ARGS=(
  --location "${REGION}"
  --schedule "* * * * *"
  --time-zone "Etc/UTC"
  --uri "${AGENT_URL}/durable/tick"
  --http-method POST
  --oidc-service-account-email "harmonia-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
  --oidc-token-audience "${AGENT_URL}"
  --attempt-deadline 300s
  --project "${PROJECT_ID}"
)
if gcloud scheduler jobs describe harmonia-durable-autonomy --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http harmonia-durable-autonomy "${SCHEDULER_ARGS[@]}"
else
  gcloud scheduler jobs create http harmonia-durable-autonomy "${SCHEDULER_ARGS[@]}"
fi

# Resident cycles are separate from the precise effect dispatcher above and are
# never provisioned unless the operator explicitly opts in.
if [[ "${HARMONIA_ENABLE_RESIDENT_AUTONOMY:-0}" == "1" ]]; then
  RESIDENT_TIMEZONE="${HARMONIA_WORKSPACE_TIMEZONE:-Etc/UTC}"
  provision_resident_schedule() {
    local name="$1" schedule="$2" path="$3"
    local args=(--location "${REGION}" --schedule "${schedule}" --time-zone "${RESIDENT_TIMEZONE}" --uri "${AGENT_URL}${path}" --http-method POST --oidc-service-account-email "harmonia-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" --oidc-token-audience "${AGENT_URL}" --attempt-deadline 300s --project "${PROJECT_ID}")
    if gcloud scheduler jobs describe "${name}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
      gcloud scheduler jobs update http "${name}" "${args[@]}"
    else
      gcloud scheduler jobs create http "${name}" "${args[@]}"
    fi
  }
  provision_resident_schedule harmonia-resident-heartbeat "0 * * * *" /durable/heartbeat
  provision_resident_schedule harmonia-resident-dream "0 2 * * *" /durable/dream
  provision_resident_schedule harmonia-resident-wakeup "0 7 * * *" /durable/wakeup
else
  echo "Resident autonomy schedules disabled (HARMONIA_ENABLE_RESIDENT_AUTONOMY=0)."
fi

echo
echo "Deployed. Dashboard: ${WEB_URL}"
echo "Smoke test:"
echo "  curl -s ${WEB_URL}/api/health || true"
