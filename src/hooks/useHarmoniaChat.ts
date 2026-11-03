"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "@/lib/clientApi";
import { initialChatRunState, reduceChatStreamEvent, type ChatRunState } from "@/lib/a2ui/chatReducer";
import { parseChatStreamEvent, type ChatStreamEvent } from "@/lib/a2ui/contracts";

async function consumeNdjson(response: Response, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  if (!response.body) throw new Error("chat stream returned no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(parseChatStreamEvent(JSON.parse(line)));
    if (done) break;
  }
  if (buffer.trim()) onEvent(parseChatStreamEvent(JSON.parse(buffer)));
}

interface ReplayChatRunInput {
  runId: string;
  afterSequence: number;
  onEvent: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  request?: (input: string, init?: RequestInit) => Promise<Response>;
  wait?: () => Promise<void>;
  maxAttempts?: number;
}

export async function replayChatRunUntilTerminal(input: ReplayChatRunInput): Promise<void> {
  const request = input.request ?? apiFetch;
  const wait = input.wait ?? (() => new Promise((resolve) => window.setTimeout(resolve, 750)));
  const maxAttempts = input.maxAttempts ?? 400;
  let lastSequence = input.afterSequence;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (input.signal?.aborted) throw new DOMException("Chat replay cancelled", "AbortError");
    const replay = await request(`/api/chat/runs/${input.runId}/events?after=${lastSequence}`, {
      cache: "no-store",
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!replay.ok) throw new Error(`Chat replay failed (${replay.status})`);
    const body = await replay.json() as { events?: unknown[] };
    for (const value of body.events ?? []) {
      const event = parseChatStreamEvent(value);
      if (event.sequence !== lastSequence + 1) {
        throw new Error(`noncontiguous chat replay: expected ${lastSequence + 1}, received ${event.sequence}`);
      }
      input.onEvent(event);
      lastSequence = event.sequence;
      if (event.type === "run_completed" || event.type === "run_failed") return;
    }
    await wait();
  }
  throw new Error("Chat replay did not reach a terminal event before timeout");
}

export function useHarmoniaChat() {
  const [run, setRun] = useState<ChatRunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (message: string, attachmentIds: string[] = [], conversationId = "primary") => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await apiFetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, surface: "dashboard", conversationId, attachmentIds }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `chat failed (${response.status})`);
    }
    const runId = response.headers.get("x-chat-run-id");
    if (!runId) throw new Error("chat stream omitted run id");
    let current = initialChatRunState(runId);
    setRun(current);
    const apply = (event: ChatStreamEvent) => {
      current = reduceChatStreamEvent(current, event);
      setRun(current);
    };
    let streamError: unknown = null;
    try {
      await consumeNdjson(response, apply);
    } catch (error) {
      if (controller.signal.aborted) throw error;
      streamError = error;
    }
    if (current.status === "running") {
      try {
        await replayChatRunUntilTerminal({
          runId,
          afterSequence: current.lastSequence,
          onEvent: apply,
          signal: controller.signal,
        });
      } catch (replayError) {
        throw streamError ?? replayError;
      }
    }
    return current;
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { run, send, cancel, clear: () => setRun(null) };
}
