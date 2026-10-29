import { listEventLog, type EventLogEntry } from "@/lib/firestore";
import { tenantHandler } from "@/lib/auth";
import { getDurableRuntimeSnapshot } from "@/lib/observability/repository";

/**
 * Searchable, filterable log stream.
 * Query params: q (text), stage (repeatable), actor, jobId, since, until, limit.
 */
async function get(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const stages = params.getAll("stage").filter(Boolean);
  const actor = params.get("actor") ?? "";
  const jobId = params.get("jobId") ?? "";
  const role = params.get("role") ?? "";
  const kind = params.get("kind") ?? "";
  const status = params.get("status") ?? "";
  const since = params.get("since");
  const until = params.get("until");
  const limit = Math.min(Math.max(Number(params.get("limit") ?? "100"), 1), 300);

  const [eventEntries, runtime] = await Promise.all([listEventLog(500), getDurableRuntimeSnapshot()]);
  let entries: EventLogEntry[] = eventEntries;

  if (q) entries = entries.filter((e) => e.message.toLowerCase().includes(q) || e.jobId.toLowerCase().includes(q));
  if (stages.length) entries = entries.filter((e) => stages.includes(e.stage));
  if (actor) entries = entries.filter((e) => e.actor === actor);
  if (jobId) entries = entries.filter((e) => e.jobId === jobId);
  if (role) entries = entries.filter((e) => e.activity?.role === role);
  if (kind) entries = entries.filter((e) => e.activity?.kind === kind);
  if (status) entries = entries.filter((e) => e.activity?.status === status);
  if (since) entries = entries.filter((e) => e.at && Date.parse(e.at) >= Date.parse(since));
  if (until) entries = entries.filter((e) => e.at && Date.parse(e.at) <= Date.parse(until));

  const total = entries.length;
  return Response.json({ events: entries.slice(0, limit), total, runtime });
}

export const GET = tenantHandler(get);
