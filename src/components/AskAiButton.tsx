"use client";

import { askAiAbout } from "@/components/ChatDrawer";

/** Small inline "Ask AI" affordance; opens the chat drawer scoped to an item. */
export default function AskAiButton({
  kind,
  id,
  label,
  className = "",
}: {
  kind: "job" | "content_item" | "proposal";
  id: string;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        askAiAbout({ kind, id, label });
      }}
      title={`Ask AI about "${label}"`}
      className={`inline-flex items-center gap-1 rounded-full border border-violet-300 px-2 py-0.5 text-[10px] font-medium text-violet-700 transition hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/50 ${className}`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
      </svg>
      Ask AI
    </button>
  );
}
