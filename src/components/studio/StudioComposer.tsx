"use client";

import type { Dispatch, SetStateAction } from "react";
import { AttachmentComposer, type ComposerAttachment } from "@/components/a2ui/AttachmentComposer";
import { SendIcon } from "@/components/icons";

interface StudioComposerProps {
  value: string;
  onChange: (value: string) => void;
  attachments: ComposerAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<ComposerAttachment[]>>;
  onSend: (message?: string) => void | Promise<void>;
  busy: boolean;
}

export function StudioComposer({ value, onChange, attachments, onAttachmentsChange, onSend, busy }: StudioComposerProps) {
  const blocked = busy || (!value.trim() && attachments.length === 0) || attachments.some((attachment) => attachment.state !== "ready");
  const send = () => onSend(value.trim() || "Use the attached source and decide how it best fits our content strategy.");
  return (
    <div className="shrink-0 border-t border-black/10 bg-[#e9e5dc] px-[15px] pb-3 pt-2.5 lg:min-h-[125px]">
      {attachments.length ? <div className="mb-2"><AttachmentComposer attachments={attachments} onChange={onAttachmentsChange} disabled={busy} /></div> : null}
      <div className="flex items-end gap-2 rounded-[14px] border border-[#11110f] bg-white p-1.5 shadow-[3px_3px_0_#11110f]">
        <AttachmentComposer attachments={[]} onChange={onAttachmentsChange} disabled={busy || attachments.length >= 20} />
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!blocked) void send();
            }
          }}
          rows={1}
          placeholder="What outcome do you need? You can speak normally…"
          className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 outline-none placeholder:text-black/40"
        />
        <button type="button" aria-label="Send message" disabled={blocked} onClick={() => void send()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#11110f] text-white transition hover:scale-105 disabled:opacity-30"><SendIcon /></button>
      </div>
      <p className="mt-2 text-center text-[11px] text-black/45">Strategy and plan context linked · publishing still needs approval</p>
    </div>
  );
}
