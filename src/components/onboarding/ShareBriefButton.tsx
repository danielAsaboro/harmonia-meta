"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/clientApi";

/** Make a no-login, read-only link to the brief and copy it. */
export function ShareBriefButton({ className }: { className?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "copied" | "error">("idle");

  async function share() {
    setState("working");
    const response = await apiFetch("/api/onboarding/website/share", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.path) { setState("error"); return; }
    const url = new URL(body.path, window.location.origin).toString();
    setLink(url);
    try { await navigator.clipboard.writeText(url); setState("copied"); } catch { setState("idle"); }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void share()} disabled={state === "working"} className={className ?? "rounded-full border border-[#11110f] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40"}>
        {state === "copied" ? "Link copied" : state === "error" ? "Couldn't share, try again" : "Share brief"}
      </button>
      {link ? <a href={link} target="_blank" rel="noreferrer" className="max-w-[260px] truncate font-mono text-[11px] text-black/50 underline-offset-2 hover:underline" data-share-link>{link}</a> : null}
    </span>
  );
}
