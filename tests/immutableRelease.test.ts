import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("immutable release inputs", () => {
  const web = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../agent/Dockerfile", import.meta.url), "utf8");
  const deploy = readFileSync(new URL("../infra/deploy.sh", import.meta.url), "utf8");

  it("pins both runtime base images by sha256 digest", () => {
    expect(web).toMatch(/^FROM node:[^\s]+@sha256:[a-f0-9]{64}/m);
    expect(agent).toMatch(/^FROM python:[^\s]+@sha256:[a-f0-9]{64}/m);
  });

  it("runs the web build and runtime on the Node version required by Google Cloud clients", () => {
    expect(web.match(/^FROM node:([^\s@]+)/gm)).toEqual([
      "FROM node:22-bookworm-slim",
      "FROM node:22-bookworm-slim",
      "FROM node:22-bookworm-slim",
    ]);
  });

  it("records deployed revision and image digests for both services", () => {
    expect(deploy).toContain("record_release_identity harmonia-web");
    expect(deploy).toContain("record_release_identity harmonia-agent");
    expect(deploy).toContain("status.imageDigest");
    expect(deploy).toContain("gcloud builds submit");
    expect(deploy).toContain("--image \"${WEB_IMAGE_TAG}@${WEB_IMAGE_DIGEST}\"");
    expect(deploy).toContain("--image \"${AGENT_IMAGE_TAG}@${AGENT_IMAGE_DIGEST}\"");
    expect(deploy).not.toContain("--source .");
  });
});
