import { initialChatRunState, replayChatRunEvents, type ChatRunState } from "./chatReducer";

/** Fail closed while keeping protocol corruption visible in chat history. */
export function historyRunState(runId: string, events: unknown[]): ChatRunState {
  try {
    return replayChatRunEvents(runId, events);
  } catch (error) {
    return {
      ...initialChatRunState(runId),
      status: "failed",
      error: `A2UI protocol replay failed: ${error instanceof Error ? error.message : String(error)}`,
      permanent: true,
    };
  }
}
