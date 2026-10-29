import { operatorTenantHandler } from "@/lib/auth";
import { listResidentCycles, listResidentRecords } from "@/lib/residentAutonomy/repository";

export const GET = operatorTenantHandler(async () => {
  const [cycles, agendas, items, observations, experiments, revisions, attention] = await Promise.all([
    listResidentCycles(50), listResidentRecords("agendas", 20), listResidentRecords("agenda_items", 100),
    listResidentRecords("observations", 100), listResidentRecords("experiments", 30), listResidentRecords("revisions", 30), listResidentRecords("attention", 50),
  ]);
  return Response.json({ provenance: "live_persisted_state", cycles, agendas, items, observations, experiments, revisions, attention });
});
