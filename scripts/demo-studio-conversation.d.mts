export interface DemoStudioConversationMessage {
  role: "user" | "assistant";
  surface: "dashboard";
  text: string;
  data?: Record<string, unknown>;
}

export function buildDemoStudioConversation(input: { runId: string }): DemoStudioConversationMessage[];
