#!/usr/bin/env bash
# One-time Google Cloud project bootstrap for Harmonia.
# Idempotent: safe to re-run. Requires: gcloud authenticated, billing enabled.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"

echo "== Harmonia setup on project ${PROJECT_ID} (${REGION}) =="

gcloud config set project "${PROJECT_ID}"

echo "-- Enabling services"
for svc in run.googleapis.com firestore.googleapis.com pubsub.googleapis.com \
           cloudbuild.googleapis.com artifactregistry.googleapis.com \
           secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
           cloudresourcemanager.googleapis.com \
           aiplatform.googleapis.com cloudtrace.googleapis.com \
           telemetry.googleapis.com monitoring.googleapis.com logging.googleapis.com \
           storage.googleapis.com identitytoolkit.googleapis.com cloudscheduler.googleapis.com; do
  gcloud services enable "$svc" --project "${PROJECT_ID}"
done

echo "-- Immutable release image repository"
if ! gcloud artifacts repositories describe harmonia --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create harmonia \
    --repository-format docker --location "${REGION}" \
    --description "Immutable Harmonia release images" --project "${PROJECT_ID}"
fi

echo "-- Agent Engine staging bucket"
STAGING_BUCKET="gs://${PROJECT_ID}-harmonia-agent-staging"
if ! gcloud storage buckets describe "${STAGING_BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "${STAGING_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access --project="${PROJECT_ID}"
fi
BUCKET_LOCATION="$(gcloud storage buckets describe "${STAGING_BUCKET}" \
  --project="${PROJECT_ID}" --format='value(location)' | tr '[:upper:]' '[:lower:]')"
if [[ "${BUCKET_LOCATION}" != "${REGION}" ]]; then
  echo "staging bucket is in ${BUCKET_LOCATION}; required residency region is ${REGION}" >&2
  exit 2
fi

echo "-- Durable media bucket"
ASSET_BUCKET="gs://${PROJECT_ID}-harmonia-assets"
if ! gcloud storage buckets describe "${ASSET_BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "${ASSET_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access --project="${PROJECT_ID}"
fi
ASSET_BUCKET_LOCATION="$(gcloud storage buckets describe "${ASSET_BUCKET}" \
  --project="${PROJECT_ID}" --format='value(location)' | tr '[:upper:]' '[:lower:]')"
if [[ "${ASSET_BUCKET_LOCATION}" != "${REGION}" ]]; then
  echo "asset bucket is in ${ASSET_BUCKET_LOCATION}; required residency region is ${REGION}" >&2
  exit 2
fi

echo "-- Firestore (native mode)"
if ! gcloud firestore databases describe --database='(default)' --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud firestore databases create --location="${REGION}" --type=firestore-native --project "${PROJECT_ID}"
fi
FIRESTORE_LOCATION="$(gcloud firestore databases describe --database='(default)' \
  --project "${PROJECT_ID}" --format='value(locationId)' | tr '[:upper:]' '[:lower:]')"
if [[ "${FIRESTORE_LOCATION}" != "${REGION}" ]]; then
  echo "Firestore is in ${FIRESTORE_LOCATION}; required residency region is ${REGION}" >&2
  exit 2
fi

echo "-- Firestore durable-recovery indexes"
if ! gcloud firestore indexes composite list --database='(default)' --project "${PROJECT_ID}" \
  --filter='collectionGroupId=operations AND state=READY AND fields.fieldPath:leaseExpiresAt AND fields.fieldPath:id' \
  --format='value(name)' | grep -q .; then
  gcloud firestore indexes composite create \
    --database='(default)' --collection-group=operations --query-scope=collection \
    --field-config=field-path=state,order=ascending \
    --field-config=field-path=leaseExpiresAt,order=ascending \
    --field-config=field-path=id,order=ascending \
    --project "${PROJECT_ID}"
fi
if ! gcloud firestore indexes composite list --database='(default)' --project "${PROJECT_ID}" \
  --filter='collectionGroupId=memory_facts AND state=READY AND fields.fieldPath:createdAt' \
  --format='value(name)' | grep -q .; then
  gcloud firestore indexes composite create \
    --database='(default)' --collection-group=memory_facts --query-scope=collection \
    --field-config=field-path=evidence_ref.brand_id,order=ascending \
    --field-config=field-path=createdAt,order=descending \
    --project "${PROJECT_ID}"
fi

echo "-- Pub/Sub topics"
gcloud pubsub topics create harmonia-stages --project "${PROJECT_ID}" 2>/dev/null || echo "topic exists"
gcloud pubsub topics create harmonia-stages-dlq --project "${PROJECT_ID}" 2>/dev/null || echo "dlq topic exists"
gcloud pubsub topics create harmonia-production --project "${PROJECT_ID}" 2>/dev/null || echo "production topic exists"
gcloud pubsub topics create harmonia-production-dlq --project "${PROJECT_ID}" 2>/dev/null || echo "production dlq topic exists"
gcloud pubsub topics create harmonia-data-work --project "${PROJECT_ID}" 2>/dev/null || echo "data work topic exists"
for topic in harmonia-stages harmonia-stages-dlq harmonia-production harmonia-production-dlq harmonia-data-work; do
  gcloud pubsub topics update "${topic}" --project "${PROJECT_ID}" \
    --message-storage-policy-allowed-regions="${REGION}" \
    --message-storage-policy-enforce-in-transit
done

echo "-- Service accounts"
for sa in harmonia-web harmonia-agent harmonia-pubsub-push harmonia-scheduler harmonia-malware-scanner; do
  gcloud iam service-accounts create "$sa" --project "${PROJECT_ID}" \
    --display-name "Harmonia ${sa}" 2>/dev/null || echo "sa $sa exists"
done

# The web service exchanges verified Google/Firebase ID tokens for secure
# server-side session cookies. Keep this authority narrower than Firebase Admin.
FIREBASE_SESSION_ROLE="harmoniaFirebaseSessionIssuer"
FIREBASE_SESSION_PERMISSIONS="firebaseauth.users.createSession,firebaseauth.users.get,resourcemanager.projects.get"
if ! gcloud iam roles describe "${FIREBASE_SESSION_ROLE}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam roles create "${FIREBASE_SESSION_ROLE}" --project "${PROJECT_ID}" \
    --title="Harmonia Firebase Session Issuer" \
    --description="Create and verify Harmonia Firebase server sessions" \
    --permissions="${FIREBASE_SESSION_PERMISSIONS}" --stage=GA
else
  gcloud iam roles update "${FIREBASE_SESSION_ROLE}" --project "${PROJECT_ID}" \
    --title="Harmonia Firebase Session Issuer" \
    --description="Create and verify Harmonia Firebase server sessions" \
    --permissions="${FIREBASE_SESSION_PERMISSIONS}" --stage=GA
fi
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role "projects/${PROJECT_ID}/roles/${FIREBASE_SESSION_ROLE}" >/dev/null

gcloud storage buckets add-iam-policy-binding "${ASSET_BUCKET}" \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/storage.objectAdmin --project "${PROJECT_ID}" >/dev/null
for role in roles/storage.objectCreator roles/storage.objectViewer; do
  gcloud storage buckets add-iam-policy-binding "${ASSET_BUCKET}" \
    --member "serviceAccount:harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role "${role}" --project "${PROJECT_ID}" >/dev/null
done

# Only ephemeral transcription inputs can be removed by the worker. Source and
# exported artifact retention remain outside this additional permission.
gcloud storage buckets add-iam-policy-binding "${ASSET_BUCKET}" \
  --member "serviceAccount:harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/storage.objectUser \
  --condition="expression=resource.name.startsWith('projects/_/buckets/${ASSET_BUCKET#gs://}/objects/transcription-inputs/'),title=harmonia-transcription-cleanup" \
  --project "${PROJECT_ID}" >/dev/null

# Cloud Run metadata credentials sign short-lived upload/download URLs through
# IAM Credentials. Scope that authority to the web identity signing as itself.
gcloud iam service-accounts add-iam-policy-binding \
  "harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator --project "${PROJECT_ID}" >/dev/null

# Pub/Sub's service agent must mint the OIDC token used by the private worker's
# push subscription; it receives no general project-level token authority.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format 'value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding \
  "harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator --project "${PROJECT_ID}" >/dev/null

for sa in harmonia-web harmonia-agent; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/cloudtrace.agent >/dev/null
done

for role in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role "${role}" >/dev/null
done

echo "-- IAM (least privilege)"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/datastore.user >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/pubsub.publisher >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/datastore.user >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/aiplatform.user >/dev/null
# Secret access is granted per named secret below. Cloud Run invocation is
# granted only on the private agent service after deployment.

echo "-- Secrets (skipped when value envs are unset)"
if [[ -n "${MODEL_API_KEY:-}" ]]; then
  printf '%s' "${MODEL_API_KEY}" | gcloud secrets create model-api-key --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
    || printf '%s' "${MODEL_API_KEY}" | gcloud secrets versions add model-api-key --data-file=- --project "${PROJECT_ID}"
else
  echo "  MODEL_API_KEY not provided; create secret 'model-api-key' manually."
fi
if [[ -n "${YOUTUBE_API_KEY:-}" ]]; then
  printf '%s' "${YOUTUBE_API_KEY}" | gcloud secrets create youtube-api-key --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
    || printf '%s' "${YOUTUBE_API_KEY}" | gcloud secrets versions add youtube-api-key --data-file=- --project "${PROJECT_ID}"
else
  echo "  YOUTUBE_API_KEY not provided; ingest falls back to oEmbed."
fi
if [[ -n "${GOOGLE_CSE_API_KEY:-}" ]]; then
  printf '%s' "${GOOGLE_CSE_API_KEY}" | gcloud secrets create google-cse-api-key --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
    || printf '%s' "${GOOGLE_CSE_API_KEY}" | gcloud secrets versions add google-cse-api-key --data-file=- --project "${PROJECT_ID}"
else
  echo "  GOOGLE_CSE_API_KEY not provided; Noni web research will fail closed."
fi
if [[ -n "${GOOGLE_CLIENT_ID:-}" || -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  : "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID together with GOOGLE_CLIENT_SECRET}"
  : "${GOOGLE_CLIENT_SECRET:?set GOOGLE_CLIENT_SECRET together with GOOGLE_CLIENT_ID}"
  printf '%s' "${GOOGLE_CLIENT_ID}" | gcloud secrets create google-oauth-client-id --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
    || printf '%s' "${GOOGLE_CLIENT_ID}" | gcloud secrets versions add google-oauth-client-id --data-file=- --project "${PROJECT_ID}"
  printf '%s' "${GOOGLE_CLIENT_SECRET}" | gcloud secrets create google-oauth-client-secret --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
    || printf '%s' "${GOOGLE_CLIENT_SECRET}" | gcloud secrets versions add google-oauth-client-secret --data-file=- --project "${PROJECT_ID}"
else
  echo "  Google OAuth credentials not provided; Calendar and YouTube OAuth will remain unavailable."
fi
: "${HARMONIA_CONNECTION_ENVELOPE_KEY:?set HARMONIA_CONNECTION_ENVELOPE_KEY to a private base64-encoded 32-byte key}"
printf '%s' "${HARMONIA_CONNECTION_ENVELOPE_KEY}" | gcloud secrets create harmonia-connection-envelope-key --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
  || printf '%s' "${HARMONIA_CONNECTION_ENVELOPE_KEY}" | gcloud secrets versions add harmonia-connection-envelope-key --data-file=- --project "${PROJECT_ID}"
if [[ -n "${X_CLIENT_ID:-}" || -n "${X_CLIENT_SECRET:-}" ]]; then
  : "${X_CLIENT_ID:?set X_CLIENT_ID together with X_CLIENT_SECRET}"
  : "${X_CLIENT_SECRET:?set X_CLIENT_SECRET together with X_CLIENT_ID}"
  printf '%s' "${X_CLIENT_ID}" | gcloud secrets create x-oauth-client-id --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
    || printf '%s' "${X_CLIENT_ID}" | gcloud secrets versions add x-oauth-client-id --data-file=- --project "${PROJECT_ID}"
  printf '%s' "${X_CLIENT_SECRET}" | gcloud secrets create x-oauth-client-secret --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
    || printf '%s' "${X_CLIENT_SECRET}" | gcloud secrets versions add x-oauth-client-secret --data-file=- --project "${PROJECT_ID}"
else
  echo "  X OAuth credentials not provided; X connection and publishing will remain unavailable."
fi
if ! gcloud secrets describe malware-scanner-token --project "${PROJECT_ID}" >/dev/null 2>&1; then
  SCANNER_TOKEN="${MALWARE_SCANNER_TOKEN:-$(openssl rand -hex 32)}"
  printf '%s' "${SCANNER_TOKEN}" | gcloud secrets create malware-scanner-token --data-file=- --project "${PROJECT_ID}"
elif [[ -n "${MALWARE_SCANNER_TOKEN:-}" ]]; then
  printf '%s' "${MALWARE_SCANNER_TOKEN}" | gcloud secrets versions add malware-scanner-token --data-file=- --project "${PROJECT_ID}"
fi
INTERNAL_TOKEN="$(openssl rand -hex 32)"
printf '%s' "${INTERNAL_TOKEN}" | gcloud secrets create internal-api-token --data-file=- --project "${PROJECT_ID}" 2>/dev/null \
  || echo "internal-api-token secret already exists (not rotated)"

echo "Granting secret access to both services"
for sa in harmonia-web harmonia-agent; do
  gcloud secrets add-iam-policy-binding internal-api-token \
    --member "serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor --project "${PROJECT_ID}" >/dev/null
  gcloud secrets add-iam-policy-binding model-api-key \
    --member "serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor --project "${PROJECT_ID}" >/dev/null 2>&1 || true
done
for secret in google-oauth-client-id google-oauth-client-secret harmonia-connection-envelope-key x-oauth-client-id x-oauth-client-secret; do
  gcloud secrets add-iam-policy-binding "${secret}" \
    --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor --project "${PROJECT_ID}" >/dev/null 2>&1 || true
done
gcloud secrets add-iam-policy-binding malware-scanner-token \
  --member "serviceAccount:harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor --project "${PROJECT_ID}" >/dev/null 2>&1 || true
gcloud secrets add-iam-policy-binding malware-scanner-token \
  --member "serviceAccount:harmonia-malware-scanner@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor --project "${PROJECT_ID}" >/dev/null
gcloud secrets add-iam-policy-binding youtube-api-key \
  --member "serviceAccount:harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor --project "${PROJECT_ID}" >/dev/null 2>&1 || true
gcloud secrets add-iam-policy-binding google-cse-api-key \
  --member "serviceAccount:harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor --project "${PROJECT_ID}" >/dev/null 2>&1 || true

cat <<DONE

Setup complete.
  Topic:        projects/${PROJECT_ID}/topics/harmonia-stages
  Firestore:    (default) @ ${REGION}
  Web SA:       harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com
  Agent SA:     harmonia-agent@${PROJECT_ID}.iam.gserviceaccount.com
  Push SA:      harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com
  Scheduler SA: harmonia-scheduler@${PROJECT_ID}.iam.gserviceaccount.com
  Resident jobs: disabled until HARMONIA_ENABLE_RESIDENT_AUTONOMY=1 at deploy time
  Assets:       ${ASSET_BUCKET}

Next: ./infra/deploy.sh   (deploys both Cloud Run services and wires the push subscription)
DONE
