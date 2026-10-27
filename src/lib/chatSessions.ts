import type { ChatResponse } from "@/app/api/chat/route";
import type { ChatRunState } from "@/lib/a2ui/chatReducer";
import type { ComposerAttachment } from "@/components/a2ui/AttachmentComposer";

export interface ConsoleMessage {
  id?: string;
  conversationId?: string;
  role: "user" | "assistant";
  text: string;
  data?: ChatResponse;
  surface?: string;
  at?: string | null;
  attachments?: ComposerAttachment[];
  run?: ChatRunState;
}

export interface ChatSession {
  id: string;
  conversationId: string;
  /** ISO date (YYYY-MM-DD) of the session's first message. */
  day: string;
  startedAt: string | null;
  endedAt: string | null;
  messages: ConsoleMessage[];
  surface: "dashboard" | "telegram";
}

const SESSION_GAP_MS = 30 * 60 * 1000;
const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function conversationPath(conversationId: string): string {
  if (!CONVERSATION_ID.test(conversationId)) throw new Error("invalid conversation id");
  return `/dashboard/${conversationId}`;
}

function dayLabel(dayIso: string): string {
  const d = new Date(`${dayIso}T12:00:00`);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Groups an ordered message list into sessions by time gap or surface change. */
export function groupSessions(messages: ConsoleMessage[]): ChatSession[] {
  const sessions: ChatSession[] = [];
  let current: ChatSession | null = null;

  for (const m of messages) {
    const atMs = m.at ? Date.parse(m.at) : null;
    const isTelegram = m.surface === "telegram";

    const needsNew =
      !current ||
      (!m.conversationId && atMs !== null &&
        current.endedAt !== null &&
        Date.parse(current.endedAt) + SESSION_GAP_MS < atMs) ||
      (!!current && (m.conversationId ?? "primary") !== current.conversationId) ||
      (!!current && isTelegram !== (current.surface === "telegram"));

    if (needsNew || !current) {
      current = {
        id: `${m.conversationId ?? "primary"}-s${sessions.length}`,
        conversationId: m.conversationId ?? "primary",
        day: m.at ? m.at.slice(0, 10) : "unknown",
        startedAt: m.at ?? null,
        endedAt: m.at ?? null,
        messages: [m],
        surface: isTelegram ? "telegram" : "dashboard",
      };
      sessions.push(current);
    } else {
      current.messages.push(m);
      if (m.at) current.endedAt = m.at;
    }
  }
  return sessions;
}

export { dayLabel };

export function sessionPreview(s: ChatSession): string {
  const firstUser = s.messages.find((m) => m.role === "user");
  return (firstUser?.text ?? s.messages[0]?.text ?? "").slice(0, 80);
}
