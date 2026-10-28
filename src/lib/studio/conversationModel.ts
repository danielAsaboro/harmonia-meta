import type { ChatRunState } from "@/lib/a2ui/chatReducer";
import type { ConsoleMessage } from "@/lib/chatSessions";
import type { ComposerAttachment } from "@/components/a2ui/AttachmentComposer";

export type StudioChapterKey = "discovery" | "narrative" | "production" | "approval";

export interface StudioConversationMessage extends ConsoleMessage {
  id?: string;
  run?: ChatRunState;
  attachments?: ComposerAttachment[];
}

export interface StudioChapter {
  key: StudioChapterKey;
  label: string;
  messages: StudioConversationMessage[];
  summary: string;
}

const CHAPTERS: Array<{ key: StudioChapterKey; label: string }> = [
  { key: "discovery", label: "Discover" },
  { key: "narrative", label: "Shape the story" },
  { key: "production", label: "Produce" },
  { key: "approval", label: "Review & approve" },
];

function messageJobIds(message: StudioConversationMessage): string[] {
  const ids: string[] = [];
  if (message.data?.jobId) ids.push(message.data.jobId);
  if (message.data?.job?.id) ids.push(message.data.job.id);
  for (const job of message.data?.jobs ?? []) ids.push(job.id);
  for (const update of message.run?.jobUpdates ?? []) ids.push(update.jobId);
  return ids;
}

export function referencedJobIds(messages: StudioConversationMessage[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const message of messages) {
    for (const id of messageJobIds(message)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function activeJobIdForConversation(messages: StudioConversationMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const ids = messageJobIds(messages[index]);
    if (ids.length > 0) return ids.at(-1) ?? null;
  }
  return null;
}

export function chapterForExchange(
  _user: StudioConversationMessage | undefined,
  assistant: StudioConversationMessage | undefined,
): StudioChapterKey {
  const data = assistant?.data;
  if (
    data?.intent === "approve" ||
    Boolean(data?.pendingActions?.length) ||
    Boolean(assistant?.run?.confirmations.length)
  ) return "approval";
  if (data?.intent === "list_artifacts" || Boolean(data?.artifacts?.length)) return "narrative";
  if (
    data?.intent === "create_job" ||
    Boolean(data?.assets?.length) ||
    Boolean(assistant?.run?.jobUpdates.length)
  ) return "production";
  return "discovery";
}

function summaryFor(key: StudioChapterKey, messages: StudioConversationMessage[]): string {
  const firstRequest = messages.find((message) => message.role === "user")?.text ?? "Agent update";
  const jobs = referencedJobIds(messages);
  const phase = CHAPTERS.find((chapter) => chapter.key === key)?.label ?? key;
  return `${phase} · ${messages.length} turns · ${jobs.length} job${jobs.length === 1 ? "" : "s"} · ${firstRequest.slice(0, 96)}`;
}

export function buildStudioChapters(messages: StudioConversationMessage[]): StudioChapter[] {
  const grouped = new Map<StudioChapterKey, StudioConversationMessage[]>();

  for (let index = 0; index < messages.length;) {
    const first = messages[index];
    if (first.role === "user") {
      const assistant = messages[index + 1]?.role === "assistant" ? messages[index + 1] : undefined;
      const key = chapterForExchange(first, assistant);
      grouped.set(key, [...(grouped.get(key) ?? []), first, ...(assistant ? [assistant] : [])]);
      index += assistant ? 2 : 1;
      continue;
    }

    const key = chapterForExchange(undefined, first);
    grouped.set(key, [...(grouped.get(key) ?? []), first]);
    index += 1;
  }

  return CHAPTERS.flatMap(({ key, label }) => {
    const chapterMessages = grouped.get(key);
    return chapterMessages?.length
      ? [{ key, label, messages: chapterMessages, summary: summaryFor(key, chapterMessages) }]
      : [];
  });
}
