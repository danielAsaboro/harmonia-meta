"use client";

import { useMemo, useRef, useState } from "react";
import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";
import type { Dispatch, SetStateAction } from "react";
import type { ComposerAttachment } from "@/components/a2ui/AttachmentComposer";
import type { ChatRunState } from "@/lib/a2ui/chatReducer";
import type { StudioChapter, StudioConversationMessage } from "@/lib/studio/conversationModel";
import { ConversationTurn } from "./ConversationTurn";
import { StudioComposer } from "./StudioComposer";
import { StudioEmpty, StudioLoading } from "./StudioStates";

interface ConversationPaneProps {
  chapters: StudioChapter[];
  liveRun?: ChatRunState | null;
  loaded: boolean;
  input: string;
  onInputChange: (value: string) => void;
  attachments: ComposerAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<ComposerAttachment[]>>;
  busy: boolean;
  onSend: (message?: string) => void | Promise<void>;
  onActivateArtifact: (artifactId: string) => void;
  onActivateJob: (jobId: string) => void;
  headerAccessory?: React.ReactNode;
  campaignTitle?: string;
  artifactCount?: number;
}

export function ConversationPane(props: ConversationPaneProps) {
  const [activeChapter, setActiveChapter] = useState(props.chapters.at(-1)?.key ?? "discovery");
  const [query, setQuery] = useState("");
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleChapters = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.chapters;
    return props.chapters.flatMap((chapter) => {
      const messages = chapter.messages.filter((message) => `${message.text} ${message.data?.artifacts?.map((artifact) => contentArtifactPreview(artifact)).join(" ") ?? ""}`.toLowerCase().includes(needle));
      return messages.length ? [{ ...chapter, messages }] : [];
    });
  }, [props.chapters, query]);

  function goToChapter(key: StudioChapter["key"]) {
    setActiveChapter(key);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`chapter-${key}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  const liveMessage: StudioConversationMessage | null = props.liveRun?.status === "running"
    ? { role: "assistant", text: props.liveRun.text, run: props.liveRun }
    : null;
  const turnCount = props.chapters.reduce((sum, chapter) => sum + chapter.messages.length, 0);

  return (
    <section className="flex h-full min-h-0 flex-col border-r border-black/10 bg-[#e9e5dc]" data-a2ui-slot="conversation">
      <header className="h-[118px] shrink-0 border-b border-black/10 px-[18px] pb-3 pt-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-lg">‹</span>
          <h1 className="truncate text-sm font-extrabold tracking-tight">{props.campaignTitle || "Untitled campaign"}</h1>
          <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[8px] text-[#348666]"><i className={`h-1.5 w-1.5 rounded-full ${props.liveRun ? "animate-pulse bg-[#ff765f]" : "bg-[#3fc389]"}`} />{props.liveRun ? "working" : "synced"}</span>
        </div>
        <div className="my-2 font-mono text-[8px] text-[#77736b]">{turnCount} turns · {props.artifactCount ?? 0} artifacts · updated now</div>
        <nav className="flex gap-1 overflow-x-auto" aria-label="Conversation chapters">
          {props.chapters.map((chapter) => (
            <button key={chapter.key} type="button" onClick={() => goToChapter(chapter.key)} aria-current={activeChapter === chapter.key ? "step" : undefined} className={`shrink-0 rounded-full px-2 py-1 font-mono text-[8px] ${activeChapter === chapter.key ? "bg-[#11110f] text-white" : "bg-[#dcd7cc] text-[#6d6962]"}`}><span className={activeChapter === chapter.key ? "text-[#d8ff3e]" : ""}>{chapter.label}</span> {chapter.messages.length}</button>
          ))}
        </nav>
      </header>

      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-black/10 px-[18px] font-mono text-[8px] text-[#817d74]">
        <label className="flex min-w-0 flex-1 items-center gap-2"><span aria-hidden>⌕</span><span className="sr-only">Search this conversation</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this conversation" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#817d74]" /></label>
        {props.headerAccessory}<span className="shrink-0">{Math.max(0, props.chapters.length - 1)} bookmarks</span>
      </div>

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto overscroll-contain px-[15px] py-[13px]"
        onScroll={(event) => {
          const node = event.currentTarget;
          setAwayFromLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 240);
        }}
      >
        {!props.loaded ? <StudioLoading label="Loading conversation" /> : null}
        {props.loaded && visibleChapters.length === 0 ? <StudioEmpty title={query ? "No matching turns" : "Start with the raw idea"}>{query ? "Try a different phrase." : "Talk it through, attach source material, or ask Harmonia to explore a narrative."}</StudioEmpty> : null}
        <div className="space-y-5">
          {visibleChapters.map((chapter) => {
            const hidden = chapter.messages.length > 6 ? chapter.messages.slice(0, -6) : [];
            const recent = hidden.length ? chapter.messages.slice(-6) : chapter.messages;
            return (
              <section key={chapter.key} id={`chapter-${chapter.key}`} className="scroll-mt-4" aria-labelledby={`chapter-title-${chapter.key}`}>
                <div className="mb-3 text-center font-mono text-[7px] uppercase tracking-[0.1em] text-[#8a867e]"><span id={`chapter-title-${chapter.key}`}>{chapter.label} chapter</span> · {chapter.messages.length} turns</div>
                {hidden.length ? <details className="mb-3 rounded-[14px] border border-black/10 bg-[#f3efe6] p-2.5"><summary className="cursor-pointer text-[9px] font-bold">Earlier in this chapter <span className="float-right font-mono text-[7px] font-normal text-[#777]">{hidden.length} turns collapsed</span></summary><p className="mt-1.5 text-[9px] leading-[1.45] text-[#6f6b63]">{chapter.summary}</p><div className="mt-4 space-y-3">{hidden.map((message, index) => <ConversationTurn key={`${message.at ?? "turn"}-${index}`} message={message} onActivateArtifact={props.onActivateArtifact} onActivateJob={props.onActivateJob} onRequestSurfaceRevision={props.onSend} />)}</div></details> : null}
                <div className="space-y-3">{recent.map((message, index) => <ConversationTurn key={`${message.at ?? "turn"}-${index}`} message={message} onActivateArtifact={props.onActivateArtifact} onActivateJob={props.onActivateJob} onRequestSurfaceRevision={props.onSend} />)}</div>
              </section>
            );
          })}
          {liveMessage ? <ConversationTurn message={liveMessage} live onActivateArtifact={props.onActivateArtifact} onActivateJob={props.onActivateJob} onRequestSurfaceRevision={props.onSend} /> : null}
        </div>
        {awayFromLatest ? <button type="button" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })} className="sticky bottom-3 left-1/2 mt-4 -translate-x-1/2 rounded-full bg-[#3157ff] px-4 py-2 text-xs font-bold text-white shadow-xl">↓ Return to latest</button> : null}
      </div>

      <StudioComposer value={props.input} onChange={props.onInputChange} attachments={props.attachments} onAttachmentsChange={props.onAttachmentsChange} onSend={props.onSend} busy={props.busy} />
    </section>
  );
}
