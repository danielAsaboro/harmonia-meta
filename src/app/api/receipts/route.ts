import { listRecentReceipts } from "@/lib/firestore";
import { tenantHandler } from "@/lib/auth";

async function get(req: Request) {
  const outcome = new URL(req.url).searchParams.getAll("outcome").filter(Boolean);
  let receipts = await listRecentReceipts();
  if (outcome.length) receipts = receipts.filter((r) => outcome.includes(r.outcome));
  return Response.json({ receipts });
}

export const GET = tenantHandler(get);
