#!/usr/bin/env bash
# Deploy only the Harmonia web UI on a scale-to-zero Cloud Run service.
# This path intentionally excludes the worker, Agent Engine, Memory Bank,
# Vertex endpoints, Gemini credentials, Pub/Sub subscriptions, and publishers.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
FIREBASE_API_KEY="${FIREBASE_API_KEY:?set FIREBASE_API_KEY for Identity Platform web sign-in}"
FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-${PROJECT_ID}.firebaseapp.com}"
FIREBASE_APP_ID="${FIREBASE_APP_ID:?set FIREBASE_APP_ID for the registered web application}"
APP_URL="${APP_URL:-https://useharmonia.xyz}"
GCS_BUCKET="${GCS_BUCKET:-${PROJECT_ID}-harmonia-assets}"

secret_exists() {
  gcloud secrets describe "$1" --project "${PROJECT_ID}" >/dev/null 2>&1
}

for secret_name in \
  internal-api-token \
  google-oauth-client-id \
  google-oauth-client-secret \
  harmonia-connection-envelope-key \
  instagram-app-secret \
  x-oauth-client-id \
  x-oauth-client-secret \
  linkedin-client-id \
  linkedin-client-secret \
  linkedin-organization-client-id \
  linkedin-organization-client-secret \
  tiktok-client-key \
  tiktok-client-secret; do
  if ! secret_exists "${secret_name}"; then
    echo "required preview secret '${secret_name}' not found" >&2
    exit 2
  fi
done

gcloud config set project "${PROJECT_ID}"

echo "== Deploying scale-to-zero Harmonia web preview =="
gcloud run deploy harmonia-web \
  --source . \
  --region "${REGION}" \
  --service-account "harmonia-web@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 40 \
  --timeout 60 \
  --min-instances 0 \
  --max-instances 1 \
  --cpu-throttling \
  --set-build-env-vars "NEXT_PUBLIC_FIREBASE_API_KEY=${FIREBASE_API_KEY},NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN},NEXT_PUBLIC_FIREBASE_PROJECT_ID=${PROJECT_ID},NEXT_PUBLIC_FIREBASE_APP_ID=${FIREBASE_APP_ID},NEXT_PUBLIC_APP_URL=${APP_URL}" \
  --update-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GCS_BUCKET=${GCS_BUCKET},NEXT_PUBLIC_APP_URL=${APP_URL},HARMONIA_PREVIEW_MODE=1,HARMONIA_TELEMETRY_ENABLED=0,GENERATIVE_MEDIA_ENABLED=false" \
  --update-secrets "INTERNAL_API_TOKEN=internal-api-token:latest,GOOGLE_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest,HARMONIA_CONNECTION_ENVELOPE_KEY=harmonia-connection-envelope-key:latest,INSTAGRAM_APP_SECRET=instagram-app-secret:latest,X_CLIENT_ID=x-oauth-client-id:latest,X_CLIENT_SECRET=x-oauth-client-secret:latest,LINKEDIN_CLIENT_ID=linkedin-client-id:latest,LINKEDIN_CLIENT_SECRET=linkedin-client-secret:latest,LINKEDIN_ORGANIZATION_CLIENT_ID=linkedin-organization-client-id:latest,LINKEDIN_ORGANIZATION_CLIENT_SECRET=linkedin-organization-client-secret:latest,TIKTOK_CLIENT_KEY=tiktok-client-key:latest,TIKTOK_CLIENT_SECRET=tiktok-client-secret:latest" \
  --project "${PROJECT_ID}"

WEB_URL="$(gcloud run services describe harmonia-web \
  --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)')"

CORS_FILE="$(mktemp)"
trap 'rm -f "${CORS_FILE}"' EXIT
printf '[{"origin":["%s","%s"],"method":["GET","HEAD","PUT"],"responseHeader":["Content-Type","Range","x-goog-resumable"],"maxAgeSeconds":3600}]' \
  "${WEB_URL}" "${APP_URL}" > "${CORS_FILE}"
gcloud storage buckets update "gs://${GCS_BUCKET}" \
  --cors-file="${CORS_FILE}" --project "${PROJECT_ID}"

cat <<DONE

Web preview deployed: ${WEB_URL}
Custom-domain target: ${APP_URL}

Paid runtime exclusions:
  Agent worker:       not deployed
  Agent Engine:       not deployed
  Memory Bank:        not deployed
  Gemini API secret:  not mounted
  Pub/Sub subscriber: not created
DONE
