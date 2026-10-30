"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiFetch } from "@/lib/clientApi";
import { AttachmentCard, type AttachmentView } from "./HarmoniaElements";

export interface ComposerAttachment extends AttachmentView {
  progress: number;
  error?: string;
}

function uploadBytes(url: string, file: File, headers: Record<string, string>, onProgress: (progress: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.withCredentials = url.startsWith("/");
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("upload transport failed"));
    request.onabort = () => reject(new Error("upload cancelled"));
    request.onload = () => request.status >= 200 && request.status < 300
      ? resolve()
      : reject(new Error(`upload failed (${request.status})`));
    request.send(file);
  });
}

export function AttachmentComposer({ attachments, onChange, disabled }: { attachments: ComposerAttachment[]; onChange: Dispatch<SetStateAction<ComposerAttachment[]>>; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function patch(id: string, update: Partial<ComposerAttachment>) {
    onChange((current) => current.map((item) => item.attachmentId === id ? { ...item, ...update } : item));
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files).slice(0, Math.max(0, 10 - attachments.length))) {
      try {
        const sessionResponse = await apiFetch("/api/chat/attachments/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, mime: file.type, sizeBytes: file.size }),
        });
        const session = await sessionResponse.json() as {
          error?: string;
          attachment?: { id: string; filename: string; mime: string; sizeBytes: number; state: "uploading" | "ready" };
          uploadUrl?: string;
          headers?: Record<string, string>;
        };
        if (!sessionResponse.ok || !session.attachment || !session.uploadUrl) throw new Error(session.error ?? "upload session failed");
        const next: ComposerAttachment = {
          attachmentId: session.attachment.id,
          filename: session.attachment.filename,
          mime: session.attachment.mime,
          sizeBytes: session.attachment.sizeBytes,
          state: "uploading",
          progress: 0,
        };
        onChange((current) => [...current, next]);
        await uploadBytes(session.uploadUrl, file, session.headers ?? { "content-type": file.type }, (progress) => patch(next.attachmentId, { progress }));
        const completeResponse = await apiFetch(`/api/chat/attachments/${next.attachmentId}/complete`, { method: "POST" });
        const complete = await completeResponse.json() as { error?: string; attachment?: { previewUrl?: string } };
        if (!completeResponse.ok) throw new Error(complete.error ?? "upload verification failed");
        patch(next.attachmentId, { state: "ready", progress: 100, previewUrl: complete.attachment?.previewUrl });
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
        setError(message);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      {attachments.length > 0 && <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{attachments.map((attachment) => <div key={attachment.attachmentId}><AttachmentCard attachment={attachment} onRemove={() => onChange((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))} />{attachment.state === "uploading" && <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900"><div className="h-full bg-sky-500" style={{ width: `${attachment.progress}%` }} /></div>}</div>)}</div>}
      <input ref={inputRef} type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime,audio/*,application/pdf,text/plain,text/markdown,text/csv" className="hidden" onChange={(event) => void addFiles(event.target.files)} />
      <button type="button" disabled={disabled || attachments.length >= 10} onClick={() => inputRef.current?.click()} className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">＋ Attach</button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
