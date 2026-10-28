import { createHash } from "node:crypto";
import { agendaItemSchema, agendaSchema, type agendaAuthoritySchema } from "./contracts";
import { validateAutoTuneCandidate } from "./policy";
import type { z } from "zod";

type Authority = z.infer<typeof agendaAuthoritySchema>;
export interface AgendaDraftItem { key: string; title: string; evidenceRefs: readonly string[]; estimatedCostUsd: number; deadline: string; risk: "low" | "medium" | "high"; authority: Authority; tuning?: { category: string; currentValue: unknown; candidateValue: unknown } }
export interface WakeupAgendaInput { workspaceId: string; brandId: string; cycleId: string; scheduledFor: string; createdAt: string; briefing: string; items: readonly AgendaDraftItem[] }
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export function buildWakeupAgenda(input: WakeupAgendaInput) {
  const agendaId = digest(`${input.workspaceId}\n${input.brandId}\n${input.cycleId}\n${input.scheduledFor}`);
  const items = input.items.map((draft) => {
    let authority = draft.authority;
    if (authority === "auto_tune") {
      if (!draft.tuning) authority = "propose";
      else if (validateAutoTuneCandidate(draft.tuning).decision !== "auto_tune") authority = "propose";
    }
    const id = digest(`${agendaId}\n${draft.key}`);
    return agendaItemSchema.parse({ id, workspaceId: input.workspaceId, brandId: input.brandId, agendaId, idempotencyKey: digest(`${id}\n${authority}`), title: draft.title, evidenceRefs: draft.evidenceRefs, estimatedCostUsd: draft.estimatedCostUsd, deadline: draft.deadline, risk: draft.risk, authority, state: "pending" });
  });
  const agenda = agendaSchema.parse({ id: agendaId, workspaceId: input.workspaceId, brandId: input.brandId, cycleId: input.cycleId, scheduledFor: input.scheduledFor, briefing: input.briefing, itemIds: items.map((item) => item.id), state: "scheduled", createdAt: input.createdAt });
  return { agenda, items };
}
