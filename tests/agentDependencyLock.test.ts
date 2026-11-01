import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent image dependency contract", () => {
  const dockerfile = readFileSync(new URL("../agent/Dockerfile", import.meta.url), "utf8");
  const direct = readFileSync(new URL("../agent/requirements.txt", import.meta.url), "utf8");
  const lock = readFileSync(new URL("../agent/requirements.lock", import.meta.url), "utf8");

  it("ships the real YouTube downloader used by media extraction", () => {
    expect(direct).toMatch(/^yt-dlp[<=>]/m);
    expect(lock).toMatch(/^yt-dlp==/m);
  });

  it("builds the worker from exact resolved versions", () => {
    expect(dockerfile).toContain("COPY requirements.lock .");
    expect(dockerfile).toContain("pip install --no-cache-dir -r requirements.lock");
    expect(lock).toContain("google-adk==2.7.1");
  });

  it("installs a build-time browser for unprivileged HyperFrames rendering", () => {
    expect(dockerfile).toMatch(/apt-get install[^\n]*chromium/);
    expect(dockerfile).toContain('HYPERFRAMES_BROWSER_PATH="/usr/bin/chromium"');
  });

  it("excludes workstation dependencies from the Cloud Build source archive", () => {
    const ignoreUrl = new URL("../agent/.gcloudignore", import.meta.url);
    expect(existsSync(ignoreUrl)).toBe(true);
    const ignore = readFileSync(ignoreUrl, "utf8");
    expect(ignore).toMatch(/^\.venv\/$/m);
    expect(ignore).toMatch(/^node_modules\/$/m);
  });
});
