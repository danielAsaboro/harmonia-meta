import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function fakeGcloudEnvironment() {
  const directory = mkdtempSync(join(tmpdir(), "harmonia-infra-test-"));
  const logPath = join(directory, "gcloud.log");
  const gcloudPath = join(directory, "gcloud");
  writeFileSync(
    gcloudPath,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GCLOUD_LOG"
case "$*" in
  *"artifacts docker images describe"*) printf 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n' ;;
  *"run services describe harmonia-web"*"status.latestReadyRevisionName"*) printf 'harmonia-web-revision\\n' ;;
  *"run services describe harmonia-agent"*"status.latestReadyRevisionName"*) printf 'harmonia-agent-revision\\n' ;;
  *"run services describe harmonia-malware-scanner"*"status.latestReadyRevisionName"*) printf 'harmonia-malware-scanner-revision\\n' ;;
  *"run revisions describe"*"status.imageDigest"*) printf 'us-central1-docker.pkg.dev/project-eabd3654-89fd-476d-b23/harmonia/harmonia-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n' ;;
  *"storage buckets describe"*"format=value(location)"*) printf 'us-central1\\n' ;;
  *"firestore databases describe"*"format=value(locationId)"*) printf 'us-central1\\n' ;;
  *"run services describe harmonia-web"*) printf 'https://harmonia-web.example.run.app\\n' ;;
  *"run services describe harmonia-agent"*) printf 'https://harmonia-agent.example.run.app\\n' ;;
  *"run services describe harmonia-malware-scanner"*) printf 'https://malware-scanner.example.run.app\\n' ;;
  *"projects describe"*) printf '166794945034\\n' ;;
esac
exit 0
`,
  );
  chmodSync(gcloudPath, 0o755);
  const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      FAKE_GCLOUD_LOG: logPath,
      PROJECT_ID: "project-eabd3654-89fd-476d-b23",
      REGION: "us-central1",
      GOOGLE_CLIENT_ID: "calendar-client-id",
      GOOGLE_CLIENT_SECRET: "calendar-client-secret",
      HARMONIA_CONNECTION_ENVELOPE_KEY: "dGVzdC1vbmx5LTMyLWJ5dGUtZW52ZWxvcGUta2V5ISE=",
      X_CLIENT_ID: "x-client-id",
      X_CLIENT_SECRET: "x-client-secret",
      MALWARE_SCANNER_URL: "https://malware-scanner.example.run.app/scan",
      MALWARE_SCANNER_TOKEN: "scanner-token",
  };
  return {
    env,
    log: () => readFileSync(logPath, "utf8"),
  };
}

describe("Google Cloud deployment automation", () => {
  it("fails the web image build when Firebase client configuration is missing", () => {
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toContain('RUN test -n "$NEXT_PUBLIC_FIREBASE_API_KEY"');
    expect(dockerfile).toContain('test -n "$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"');
    expect(dockerfile).toContain('test -n "$NEXT_PUBLIC_FIREBASE_PROJECT_ID"');
    expect(dockerfile).toContain('test -n "$NEXT_PUBLIC_FIREBASE_APP_ID"');
  });

  it("deploys a scale-to-zero web preview without paid agent resources", () => {
    const fake = fakeGcloudEnvironment();

    execFileSync("bash", ["infra/deploy-web-preview.sh"], {
      cwd: repoRoot,
      env: {
        ...fake.env,
        FIREBASE_API_KEY: "firebase-api-key",
        FIREBASE_APP_ID: "firebase-app-id",
      },
    });

    const log = fake.log();
    expect(log).toContain("run deploy harmonia-web");
    expect(log).toContain("--min-instances 0");
    expect(log).toContain("--max-instances 1");
    expect(log).toContain("--cpu-throttling");
    expect(log).toContain("HARMONIA_PREVIEW_MODE=1");
    expect(log).toContain("HARMONIA_CONNECTION_ENVELOPE_KEY=harmonia-connection-envelope-key:latest");
    expect(log).toContain("TIKTOK_CLIENT_KEY=tiktok-client-key:latest");
    expect(log).toContain("TIKTOK_CLIENT_SECRET=tiktok-client-secret:latest");
    expect(log).toContain("--update-env-vars");
    expect(log).toContain("--update-secrets");
    expect(log).not.toContain("run deploy harmonia-agent");
    expect(log).not.toContain("GEMMA_VERTEX_ENDPOINT");
    expect(log).not.toContain("AGENT_ENGINE_RESOURCE");
    expect(log).not.toContain("MODEL_API_KEY=");
    expect(log).not.toContain("pubsub subscriptions create");
  });

  it("provisions server-side Google OAuth credentials as managed secrets", () => {
    const fake = fakeGcloudEnvironment();

    execFileSync("bash", ["infra/setup.sh"], { cwd: repoRoot, env: fake.env });

    expect(fake.log()).toContain("secrets create google-oauth-client-id");
    expect(fake.log()).toContain("secrets create google-oauth-client-secret");
  });

  it("mounts Google OAuth secrets into the deployed web service", () => {
    const fake = fakeGcloudEnvironment();

    execFileSync("bash", ["infra/deploy.sh"], {
      cwd: repoRoot,
      env: {
        ...fake.env,
        FIREBASE_API_KEY: "firebase-api-key",
        FIREBASE_APP_ID: "firebase-app-id",
        AGENT_ENGINE_RESOURCE: "projects/p/locations/us-central1/reasoningEngines/2",
      },
    });

    expect(fake.log()).toContain("GOOGLE_CLIENT_ID=google-oauth-client-id:latest");
    expect(fake.log()).toContain("GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest");
  });

  it("builds and deploys the authenticated ClamAV scanner before enabling uploads", () => {
    const fake = fakeGcloudEnvironment();

    execFileSync("bash", ["infra/deploy.sh"], {
      cwd: repoRoot,
      env: {
        ...fake.env,
        FIREBASE_API_KEY: "firebase-api-key",
        FIREBASE_APP_ID: "firebase-app-id",
        AGENT_ENGINE_RESOURCE: "projects/p/locations/us-central1/reasoningEngines/2",
      },
    });

    const log = fake.log();
    expect(log).toContain("builds submit . --config cloudbuild.scanner.yaml");
    expect(log).toContain("run deploy harmonia-malware-scanner");
    expect(log).toContain("--memory 2Gi");
    expect(log).toContain("MALWARE_SCANNER_TOKEN=malware-scanner-token:latest");
    expect(log).toContain("MALWARE_SCANNER_URL=https://malware-scanner.example.run.app/scan");
  });

  it("provisions and mounts the connection envelope and X OAuth secrets", () => {
    const setup = fakeGcloudEnvironment();
    execFileSync("bash", ["infra/setup.sh"], { cwd: repoRoot, env: setup.env });
    expect(setup.log()).toContain("secrets create harmonia-connection-envelope-key");
    expect(setup.log()).toContain("secrets create x-oauth-client-id");
    expect(setup.log()).toContain("secrets create x-oauth-client-secret");

    const deploy = fakeGcloudEnvironment();
    execFileSync("bash", ["infra/deploy.sh"], {
      cwd: repoRoot,
      env: {
        ...deploy.env,
        FIREBASE_API_KEY: "firebase-api-key",
        FIREBASE_APP_ID: "firebase-app-id",
        AGENT_ENGINE_RESOURCE: "projects/p/locations/us-central1/reasoningEngines/2",
      },
    });
    expect(deploy.log()).toContain("HARMONIA_CONNECTION_ENVELOPE_KEY=harmonia-connection-envelope-key:latest");
    expect(deploy.log()).toContain("X_CLIENT_ID=x-oauth-client-id:latest");
    expect(deploy.log()).toContain("X_CLIENT_SECRET=x-oauth-client-secret:latest");
    expect(deploy.log()).toContain("PUBLIC_BASE_URL=https://useharmonia.xyz");
    expect(deploy.log()).toContain("ATTACHMENT_ALLOWED_ORIGINS=https://useharmonia.xyz,https://harmonia-web.example.run.app");
  });

  it("deploys the managed scanner without external scanner configuration", () => {
    const fake = fakeGcloudEnvironment();
    delete fake.env.MALWARE_SCANNER_URL;
    delete fake.env.MALWARE_SCANNER_TOKEN;

    execFileSync("bash", ["infra/deploy.sh"], {
      cwd: repoRoot,
      env: {
        ...fake.env,
        FIREBASE_API_KEY: "firebase-api-key",
        FIREBASE_APP_ID: "firebase-app-id",
        AGENT_ENGINE_RESOURCE: "projects/p/locations/us-central1/reasoningEngines/2",
      },
    });

    const log = fake.log();
    expect(log).toContain("run deploy harmonia-malware-scanner");
    expect(log).toContain("MALWARE_SCANNER_URL=https://malware-scanner.example.run.app/scan");
    expect(log).toContain("MALWARE_SCANNER_TOKEN=malware-scanner-token:latest");
  });

  it("provisions durable media storage and authenticated Pub/Sub push authority", () => {
    const fake = fakeGcloudEnvironment();

    execFileSync("bash", ["infra/setup.sh"], { cwd: repoRoot, env: fake.env });

    expect(fake.log()).toContain("storage buckets describe gs://project-eabd3654-89fd-476d-b23-harmonia-assets");
    expect(fake.log()).toContain("storage buckets add-iam-policy-binding gs://project-eabd3654-89fd-476d-b23-harmonia-assets");
    expect(fake.log()).toContain("roles/storage.objectAdmin");
    const bucketBindings = fake.log().split("\n").filter((line) =>
      line.includes("storage buckets add-iam-policy-binding")
      && line.includes("serviceAccount:harmonia-agent@"),
    );
    expect(bucketBindings.some((line) => line.includes("roles/storage.objectCreator"))).toBe(true);
    expect(bucketBindings.some((line) => line.includes("roles/storage.objectViewer"))).toBe(true);
    expect(fake.log()).toContain("service-166794945034@gcp-sa-pubsub.iam.gserviceaccount.com");
    expect(fake.log()).toContain("roles/iam.serviceAccountTokenCreator");
  });

  it("grants the web runtime only the Firebase permissions required for server sessions", () => {
    const fake = fakeGcloudEnvironment();

    execFileSync("bash", ["infra/setup.sh"], { cwd: repoRoot, env: fake.env });

    expect(fake.log()).toContain("iam roles update harmoniaFirebaseSessionIssuer");
    expect(fake.log()).toContain("firebaseauth.users.createSession");
    expect(fake.log()).toContain("firebaseauth.users.get");
    expect(fake.log()).toContain("roles/harmoniaFirebaseSessionIssuer");
    expect(fake.log()).toContain("serviceAccount:harmonia-web@project-eabd3654-89fd-476d-b23.iam.gserviceaccount.com");
    expect(fake.log()).not.toContain("roles/firebaseauth.admin");
  });

  it("injects durable media storage and configures its deployed web origin", () => {
    const fake = fakeGcloudEnvironment();

    execFileSync("bash", ["infra/deploy.sh"], {
      cwd: repoRoot,
      env: {
        ...fake.env,
        FIREBASE_API_KEY: "firebase-api-key",
        FIREBASE_APP_ID: "firebase-app-id",
        AGENT_ENGINE_RESOURCE: "projects/p/locations/us-central1/reasoningEngines/2",
      },
    });

    expect(fake.log()).toContain("GCS_BUCKET=project-eabd3654-89fd-476d-b23-harmonia-assets");
    const agentDeploy = fake.log().split("\n").find((line) => line.includes("run deploy harmonia-agent")) ?? "";
    expect(agentDeploy).toContain("GCS_BUCKET=project-eabd3654-89fd-476d-b23-harmonia-assets");
    expect(fake.log()).toContain("storage buckets update gs://project-eabd3654-89fd-476d-b23-harmonia-assets");
    expect(fake.log()).toContain("--cors-file=");
  });

  it("converges an OIDC-authenticated durable autonomy scheduler", () => {
    const fake = fakeGcloudEnvironment();
    execFileSync("bash", ["infra/deploy.sh"], {
      cwd: repoRoot,
      env: {
        ...fake.env,
        FIREBASE_API_KEY: "firebase-api-key",
        FIREBASE_APP_ID: "firebase-app-id",
        AGENT_ENGINE_RESOURCE: "projects/p/locations/us-central1/reasoningEngines/2",
      },
    });
    const log = fake.log();
    expect(log).toContain("scheduler jobs update http harmonia-durable-autonomy");
    expect(log).toContain("--uri https://harmonia-agent.example.run.app/durable/tick");
    expect(log).toContain("--oidc-service-account-email harmonia-scheduler@");
    expect(log).toContain("serviceAccount:harmonia-scheduler@");
  });
});
