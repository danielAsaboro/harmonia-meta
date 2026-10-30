"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/clientApi";
import { PlatformIcon } from "@/components/socialIcons";
import { Button } from "@/components/dashboard/Button";
import { TextInput } from "@/components/dashboard/Controls";
import { FormField } from "@/components/dashboard/FormField";
import { SectionHeader } from "@/components/dashboard/DashboardPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";
import { AlertBanner, ErrorState, LoadingState } from "@/components/dashboard/SystemState";
import { BrandLibrariesSettings } from "@/components/settings/BrandLibrariesSettings";

interface HealthInfo {
  ok: boolean;
  service: string;
  project: string;
  model?: string;
  stages?: string[];
}

interface Goals {
  weeklyPostTarget?: number;
  audience?: string;
  voice?: string;
  topics: string[];
}

const EMPTY_GOALS: Goals = { topics: [] };

function TelegramSection() {
  const [connected, setConnected] = useState(false);
  const [chatId, setChatId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    apiFetch("/api/settings/telegram")
      .then((response) => response.json())
      .then((data) => {
        setConnected(Boolean(data.connected));
        setChatId(data.chatId ?? "");
      })
      .catch(() => setStatus("Could not load Telegram connection."));
  }, []);

  useEffect(load, [load]);

  async function connect() {
    setStatus("Saving…");
    const response = await apiFetch("/api/settings/telegram", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botToken, chatId }),
    });
    if (!response.ok) {
      setStatus("Connection could not be saved.");
      return;
    }
    setBotToken("");
    setStatus("Connected.");
    load();
  }

  async function disconnect() {
    await apiFetch("/api/settings/telegram", { method: "DELETE" });
    setConnected(false);
    setChatId("");
    setStatus("Disconnected.");
  }

  return (
    <Surface as="section" className="settings-section">
      <SectionHeader title="Telegram operator" description="Connect one bot and one allow-listed chat. Messages and approvals cannot cross workspace boundaries." metadata={<StatusBadge tone={connected ? "success" : "neutral"}>{connected ? "Connected" : "Not connected"}</StatusBadge>} />
      <div className="settings-fields settings-fields--two">
        <FormField id="telegram-token" label="Bot token" description="Stored server-side and never displayed after saving."><TextInput
          type="password"
          value={botToken}
          onChange={(event) => setBotToken(event.target.value)}
          placeholder={connected ? "enter a new bot token to replace" : "bot token"}
        /></FormField>
        <FormField id="telegram-chat" label="Allowed chat ID" description="Only this Telegram chat can submit or approve work."><TextInput
          value={chatId}
          onChange={(event) => setChatId(event.target.value)}
          placeholder="allowed chat ID"
        /></FormField>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" onClick={connect} disabled={!botToken || !chatId}>
          {connected ? "Replace connection" : "Connect"}
        </Button>
        {connected && <Button onClick={disconnect}>Disconnect</Button>}
        {status && <span className="text-xs text-zinc-500">{status}</span>}
      </div>
    </Surface>
  );
}

function GoalsSection() {
  const [goals, setGoals] = useState<Goals>(EMPTY_GOALS);
  const [topicDraft, setTopicDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/settings/goals")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setGoals({ ...EMPTY_GOALS, ...d.goals }))
      .catch(() => setLoadError("Could not load goals."));
  }, []);

  async function save(next: Goals) {
    setStatus("saving");
    try {
      const res = await apiFetch("/api/settings/goals", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }

  function addTopic() {
    const t = topicDraft.trim();
    if (!t || goals.topics.includes(t) || goals.topics.length >= 10) return;
    const next = { ...goals, topics: [...goals.topics, t] };
    setGoals(next);
    setTopicDraft("");
    void save(next);
  }

  return (
    <Surface as="section" className="settings-section settings-section--strategy">
      <SectionHeader title="Content strategy" description="The operating brief injected into research and ideation alongside verified performance history." metadata={<StatusBadge tone={status === "error" || loadError ? "danger" : status === "saved" ? "success" : status === "saving" ? "info" : "neutral"}>{status === "saving" ? "Saving" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : loadError ? "Load failed" : "Ready"}</StatusBadge>} />
      <p className="settings-save-status" role={status === "error" || loadError ? "alert" : "status"}>
        {status === "saving" && " Saving…"}
        {status === "saved" && " Saved ✓"}
        {status === "error" && " Save failed — check operator token."}
        {loadError && ` ${loadError}`}
      </p>

      <div className="settings-fields settings-fields--two">
        <FormField id="weekly-target" label="Weekly post target" description="Between 1 and 50 approved posts."><TextInput
            type="number"
            min={1}
            max={50}
            value={goals.weeklyPostTarget ?? ""}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : undefined;
              setGoals((g) => ({ ...g, weeklyPostTarget: v }));
            }}
            onBlur={() => void save(goals)}
            placeholder="e.g. 5"
          /></FormField>
        <FormField id="target-audience" label="Target audience" description="Who every draft should be useful to."><TextInput
            value={goals.audience ?? ""}
            onChange={(e) => setGoals((g) => ({ ...g, audience: e.target.value }))}
            onBlur={() => void save(goals)}
            placeholder="e.g. seed-stage technical founders"
          /></FormField>
        <FormField id="brand-voice" className="settings-field--wide" label="Brand voice" description="Specific language and tone constraints for generated drafts."><TextInput
            value={goals.voice ?? ""}
            onChange={(e) => setGoals((g) => ({ ...g, voice: e.target.value }))}
            onBlur={() => void save(goals)}
            placeholder="e.g. direct, technical, allergic to hype"
          /></FormField>
      </div>

      <div className="mt-4">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Priority topics</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {goals.topics.map((t) => (
            <button
              key={t}
              onClick={() => {
                const next = { ...goals, topics: goals.topics.filter((x) => x !== t) };
                setGoals(next);
                void save(next);
              }}
              title="Remove topic"
              className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 hover:bg-red-100 hover:text-red-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-red-950"
            >
              {t} ✕
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <TextInput aria-label="New priority topic"
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTopic()}
            placeholder="add a topic and press Enter"
          />
          <Button variant="primary" onClick={addTopic}>
            Add
          </Button>
        </div>
      </div>
    </Surface>
  );
}

interface ConnectionInfo {
  id: string;
  label: string;
  capabilities: string[];
  productAvailability: "active" | "oauth_connectable" | "credential_groundwork";
  note: string;
  docsUrl: string;
  status: "connected" | "connectable" | "credentials_needed";
  mode?: string;
  handle?: string;
  connectedAt?: string;
  expiresAt?: string;
  missingActive: string[];
  missingRequired: string[];
}

const RING: Record<string, string> = {
  connected: "ring-2 ring-emerald-400",
  connectable: "ring-2 ring-sky-400",
  credentials_needed: "ring-1 ring-zinc-200 dark:ring-zinc-800",
};

function ConnectionsSection() {
  const [connections, setConnections] = useState<ConnectionInfo[] | null>(null);
  const [banner, setBanner] = useState<{ result: string; connection: string; reason?: string } | null>(null);
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pasteToken, setPasteToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    return fetch("/api/settings/connections", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { setConnections(d.connections); setLoadError(""); })
      .catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Connections request failed"));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
      const q = new URLSearchParams(window.location.search);
      if (q.get("connection")) {
        setBanner({
          result: q.get("result") ?? "error",
          connection: q.get("connection") ?? "",
          reason: q.get("reason") ?? undefined,
        });
        window.history.replaceState({}, "", window.location.pathname);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function disconnect(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/settings/connections/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function pasteSave(id: string) {
    if (!pasteToken.trim()) return;
    setBusy(id);
    try {
      const res = await apiFetch(`/api/settings/connections/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: pasteToken.trim() }),
      });
      if (!res.ok) throw new Error();
      setPasteFor(null);
      setPasteToken("");
      await load();
    } catch {
      setBanner({ result: "error", connection: id, reason: "token could not be saved" });
    } finally {
      setBusy(null);
    }
  }

  function startOauth(id: string) {
    const url = `/api/oauth/${id}/authorize`;
    // Full navigation is intentional: the route 302s to an external consent
    // screen, so client-side routing would be wrong here.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(url);
  }

  return (
    <Surface as="section" className="settings-section settings-section--wide">
      <SectionHeader title="Connected accounts" description="Official platform APIs only. Credentials stay server-side, and every publish still passes the human approval gate." metadata={<StatusBadge tone="info">OAuth 2.0</StatusBadge>} />

      {banner && (
        <AlertBanner tone={banner.result === "ok" ? "success" : "danger"}>
          {banner.result === "ok"
            ? `${banner.connection} connected successfully.`
            : `${banner.connection} failed to connect${banner.reason ? `: ${banner.reason}` : "."}`}
        </AlertBanner>
      )}

      {loadError ? <ErrorState title="Connected accounts could not be loaded" message={loadError} action={<Button onClick={() => void load()}>Retry</Button>} /> : !connections ? (
        <LoadingState title="Loading connected accounts" />
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connections.map((c) => (
              <Surface key={c.id} variant="raised" className={`settings-connection ${RING[c.status]}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PlatformIcon id={c.id} />
                    <span className="text-sm font-semibold">{c.label}</span>
                  </div>
                  <StatusBadge tone={c.status === "connected" ? "success" : c.status === "connectable" ? "info" : "neutral"}>{c.status.replaceAll("_", " ")}</StatusBadge>
                </div>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                  {c.status === "connected"
                    ? `${c.mode === "oauth" ? "OAuth 2.0" : c.mode === "manual" ? "manual token" : "env"} · ${c.handle ?? "account"}${c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString()}` : ""}`
                    : c.capabilities.join(" · ") || "\u00a0"}
                </p>

                <div className="mt-auto flex flex-col gap-1.5 pt-3">
                  {c.status === "connected" ? (
                    <Button
                      onClick={() => disconnect(c.id)}
                      disabled={busy === c.id}
                    >
                      Disconnect
                    </Button>
                  ) : c.productAvailability === "credential_groundwork" ? (
                    <Button disabled>
                      Credential groundwork only
                    </Button>
                  ) : c.status === "connectable" ? (
                    <Button variant="primary"
                      onClick={() => startOauth(c.id)}
                    >
                      Connect with OAuth 2.0
                    </Button>
                  ) : (
                    <Button
                      disabled
                      title={c.missingRequired.length ? `Add ${c.missingRequired.join(", ")} server-side first` : undefined}
                    >
                      App config needed
                    </Button>
                  )}
                  <button
                    onClick={() => setPasteFor(pasteFor === c.id ? null : c.id)}
                    className="text-[10px] text-zinc-400 underline hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    advanced: paste token instead
                  </button>
                  {pasteFor === c.id && (
                    <div className="flex gap-1">
                      <TextInput aria-label={`${c.label} access token`}
                        value={pasteToken}
                        onChange={(e) => setPasteToken(e.target.value)}
                        placeholder="access token"
                      />
                      <Button
                        onClick={() => pasteSave(c.id)}
                        disabled={busy === c.id}
                      >
                        Save
                      </Button>
                    </div>
                  )}
                </div>
              </Surface>
            ))}
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wide text-zinc-400">
              developer setup notes
            </summary>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {connections.map((c) => (
                <li key={c.id}>
                  <span className="font-medium">{c.label}:</span> {c.note}{" "}
                  {c.missingRequired.length > 0 && (
                    <span className="font-mono">missing app env: {c.missingRequired.join(", ")}.</span>
                  )}{" "}
                  <a href={c.docsUrl} target="_blank" rel="noopener noreferrer" className="underline">docs ↗</a>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Surface>
  );
}

export default function SettingsView() {
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/health", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then(setHealth)
        .catch(() => setHealth(null));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="settings-grid">
      <GoalsSection />
      <ConnectionsSection />
      <BrandLibrariesSettings />
      <TelegramSection />

      <Surface as="section" className="settings-section">
        <SectionHeader title="Service health" description="Authenticated runtime and Google Cloud configuration reported by this deployment." metadata={<StatusBadge tone={health?.ok ? "success" : "danger"}>{health?.ok ? "Operational" : "Unavailable"}</StatusBadge>} />
        {health ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
            <dt className="text-zinc-400">Web service</dt>
            <dd className="font-mono">{health.service}</dd>
            <dt className="text-zinc-400">GCP project</dt>
            <dd className="font-mono">{health.project}</dd>
            {health.model && (
              <>
                <dt className="text-zinc-400">Model</dt>
                <dd className="font-mono">{health.model}</dd>
              </>
            )}
          </dl>
        ) : (
          <ErrorState title="Health endpoint unreachable" message="Service metadata could not be verified." />
        )}
      </Surface>

      <Surface as="section" className="settings-section">
        <SectionHeader title="Integration policy" description="The immutable boundaries applied to platform access and agent execution." />
        <ul className="mt-3 flex flex-col gap-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="text-zinc-800 dark:text-zinc-200">X publishing</strong> — each
            workspace connects its own account through OAuth; posts use the official X API v2.
          </li>
          <li>
            <strong className="text-zinc-800 dark:text-zinc-200">Telegram</strong> — configured
            independently per workspace and scoped to one allow-listed chat; approvals require
            inline-button taps.
          </li>
          <li>
            <strong className="text-zinc-800 dark:text-zinc-200">Gemini</strong> — required for
            transcription, analysis, drafting, and chat intent parsing.
          </li>
        </ul>
        <p className="mt-3 text-[11px] text-zinc-400">
          Integration credentials are server-side secrets; this page only documents their
          expected configuration and never displays them.
        </p>
      </Surface>
    </div>
  );
}
