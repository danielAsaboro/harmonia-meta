import { parseChatStreamEvent, type ChatStreamEvent } from "./contracts";

export interface ChatRunState {
  runId: string;
  status: "running" | "complete" | "failed";
  lastSequence: number;
  text: string;
  activities: Array<Extract<ChatStreamEvent, { type: "activity" }>["activity"]>;
  tools: Array<Extract<ChatStreamEvent, { type: "tool_activity" }>["tool"]>;
  operations: Record<string, unknown>[];
  confirmations: Array<Extract<ChatStreamEvent, { type: "confirmation_requested" }>["confirmation"]>;
  jobUpdates: Array<Extract<ChatStreamEvent, { type: "job_updated" }>>;
  error?: string;
  permanent?: boolean;
}

export function initialChatRunState(runId: string): ChatRunState {
  return {
    runId,
    status: "running",
    lastSequence: -1,
    text: "",
    activities: [],
    tools: [],
    operations: [],
    confirmations: [],
    jobUpdates: [],
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((candidate, candidateIndex) => candidateIndex === index ? item : candidate);
}

function toolId(tool: ChatRunState["tools"][number]): string {
  return tool.traceId ?? tool.name;
}

function upsertTool(
  tools: ChatRunState["tools"],
  tool: ChatRunState["tools"][number],
): ChatRunState["tools"] {
  const id = toolId(tool);
  const index = tools.findIndex((candidate) => toolId(candidate) === id);
  if (index === -1) return [...tools, tool];
  return tools.map((candidate, candidateIndex) => candidateIndex === index ? tool : candidate);
}

export function reduceChatStreamEvent(state: ChatRunState, event: ChatStreamEvent): ChatRunState {
  if (event.runId !== state.runId || event.sequence <= state.lastSequence) return state;
  const base = { ...state, lastSequence: event.sequence };
  switch (event.type) {
    case "run_started":
      return base;
    case "text_delta":
      return { ...base, text: state.text + event.delta };
    case "activity":
      return { ...base, activities: upsertById(state.activities, event.activity) };
    case "tool_activity":
      return { ...base, tools: upsertTool(state.tools, event.tool) };
    case "a2ui_operation":
      return { ...base, operations: [...state.operations, event.operation] };
    case "confirmation_requested":
      return { ...base, confirmations: upsertById(state.confirmations, event.confirmation) };
    case "job_updated":
      return { ...base, jobUpdates: [...state.jobUpdates, event] };
    case "run_completed":
      return { ...base, status: "complete", text: event.reply };
    case "run_failed":
      return { ...base, status: "failed", error: event.error, permanent: event.permanent };
  }
}

/** Rebuild a completed or interrupted run from its durable, untrusted event log. */
export function replayChatRunEvents(runId: string, events: unknown[]): ChatRunState {
  let state = initialChatRunState(runId);
  for (const input of events) {
    const event = parseChatStreamEvent(input);
    if (event.runId !== runId) {
      throw new Error(`chat run ${runId} received event for ${event.runId}`);
    }
    if (event.sequence !== state.lastSequence + 1) {
      throw new Error(`chat run ${runId} received non-contiguous sequence ${event.sequence} after ${state.lastSequence}`);
    }
    state = reduceChatStreamEvent(state, event);
  }
  return state;
}
