import { createHash, randomBytes } from "node:crypto";
import { db, getGoals } from "@/lib/firestore";
import type { StoredBrandBrief } from "@/lib/brandBrief";
import { currentTenant } from "@/lib/tenancy";

/**
 * A read-only link to the workspace's brand brief that opens without a login. Only the
 * token's hash is stored, the shared copy is a snapshot (later edits need a new link), and
 * the page can neither start work nor spend model budget.
 */
const SHARES = "briefShares";
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{32}$/;

export type SharedBrief = Omit<StoredBrandBrief, "modelCalls"> & {
  modelCalls: Array<Omit<StoredBrandBrief["modelCalls"][number], "responseId">>;
};

interface ShareDoc { workspaceId: string; brandId: string; createdAt: string; brief: SharedBrief }

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function sharedSnapshot(brief: StoredBrandBrief): SharedBrief {
  return JSON.parse(JSON.stringify({ ...brief, modelCalls: brief.modelCalls.map(({ responseId: _responseId, ...call }) => call) }));
}

/** Replace the workspace's share link with a new one for the current brief. */
export async function shareBrandBrief(): Promise<{ token: string; createdAt: string }> {
  const tenant = currentTenant();
  const goals = await getGoals();
  if (!goals.brandBrief) throw new Error("no brand brief to share yet");
  await revokeBriefShares();
  const token = randomBytes(24).toString("base64url");
  const createdAt = new Date().toISOString();
  const doc: ShareDoc = { workspaceId: tenant.workspaceId, brandId: tenant.brandId, createdAt, brief: sharedSnapshot(goals.brandBrief) };
  await db().collection(SHARES).doc(tokenHash(token)).create(doc);
  return { token, createdAt };
}

export async function revokeBriefShares(): Promise<number> {
  const tenant = currentTenant();
  const snap = await db().collection(SHARES).where("workspaceId", "==", tenant.workspaceId).where("brandId", "==", tenant.brandId).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  return snap.size;
}

export async function readSharedBrief(token: string): Promise<{ brief: SharedBrief; createdAt: string } | null> {
  if (!SHARE_TOKEN.test(token)) return null;
  const snap = await db().collection(SHARES).doc(tokenHash(token)).get();
  if (!snap.exists) return null;
  const doc = snap.data() as ShareDoc;
  return { brief: doc.brief, createdAt: doc.createdAt };
}
