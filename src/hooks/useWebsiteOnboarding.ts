"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredBrief } from "@/components/onboarding/BriefSummary";
import { apiFetch } from "@/lib/clientApi";
import type { OnboardingRun } from "@/lib/onboardingSteps";

const POLL_MS = 2_000;

/** The workspace's brand brief and its latest website onboarding run, polled while it runs. */
export function useWebsiteOnboarding() {
  const [brief, setBrief] = useState<StoredBrief | null>(null);
  const [run, setRun] = useState<OnboardingRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hadBriefAtLoad, setHadBriefAtLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/api/onboarding/website").then((r) => (r.ok ? r.json() : null)),
      apiFetch("/api/onboarding/website/status").then((r) => (r.ok ? r.json() : null)),
    ]).then(([current, status]) => {
      if (cancelled) return;
      setBrief(current?.brandBrief ?? null);
      setHadBriefAtLoad(Boolean(current?.brandBrief));
      setRun(status?.run ?? null);
    }).catch(() => undefined).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const running = run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      apiFetch("/api/onboarding/website/status").then((r) => (r.ok ? r.json() : null)).then((status) => {
        if (!status?.run) return;
        setRun(status.run);
        if (status.brandBrief) setBrief(status.brandBrief);
      }).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const start = useCallback(async (url: string) => {
    setError(null);
    const response = await apiFetch("/api/onboarding/website", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.run) { setError(body.error ?? `Could not start (HTTP ${response.status}).`); return; }
    setRun(body.run);
  }, []);

  return { brief, setBrief, run, loaded, hadBriefAtLoad, error, start };
}
