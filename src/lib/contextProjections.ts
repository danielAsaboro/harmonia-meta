import { createHash } from "node:crypto";

import { canonicalJson } from "./recordReplay/integrity";
import type { ArtifactTrust } from "./artifacts";

export interface ProjectionConstraintRef { id: string; digest: string }
export interface ProjectionRevisionRef { kind: string; id: string; revision: number; digest: string }
export interface ProjectionEvidenceRef { id: string; trust: ArtifactTrust; digest: string; artifactId?: string }
export interface ProjectionMemoryRef { id: string; digest: string; evidenceRef: string }

export interface ContextProjectionManifest {
  compilerVersion: string;
  operationId: string;
  operationEpoch: number;
  model: string;
  goalDigest: string;
  policyVersion: string;
  pinnedConstraints: ProjectionConstraintRef[];
  approvalIds: string[];
  unresolvedEffectIds: string[];
  currentRevisions: ProjectionRevisionRef[];
  evidence: ProjectionEvidenceRef[];
  memory: ProjectionMemoryRef[];
  recentEventIds: string[];
  artifactRefs: string[];
  maxChars: number;
}

export interface ContextProjectionRecord {
  id: string;
  compilerVersion: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  operationId: string;
  operationEpoch: number;
  model: string;
  goalDigest: string;
  policyVersion: string;
  pinnedConstraintIds: string[];
  approvalIds: string[];
  unresolvedEffectIds: string[];
  currentRevisionRefs: string[];
  evidenceRefs: string[];
  artifactRefs: string[];
  recentEventIds: string[];
  manifest: ContextProjectionManifest;
  manifestDigest: string;
  renderedDigest: string;
  renderedChars: number;
  renderedArtifactId: string;
  createdAt: string;
}

export interface CreateContextProjectionInput {
  workspaceId: string;
  brandId: string;
  jobId: string;
  manifest: ContextProjectionManifest;
  renderedDigest: string;
  renderedChars: number;
  renderedArtifactId: string;
  now: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertDigest(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be sha256`);
}

function assertManifest(manifest: ContextProjectionManifest): void {
  if (!manifest.compilerVersion || !manifest.operationId || !manifest.model || !manifest.policyVersion) {
    throw new Error("context projection manifest identity is incomplete");
  }
  if (!Number.isSafeInteger(manifest.operationEpoch) || manifest.operationEpoch < 1) {
    throw new Error("context projection epoch is invalid");
  }
  if (!Number.isSafeInteger(manifest.maxChars) || manifest.maxChars < 500 || manifest.maxChars > 200_000) {
    throw new Error("context projection character budget is invalid");
  }
  assertDigest(manifest.goalDigest, "projection goal digest");
  for (const item of manifest.pinnedConstraints) assertDigest(item.digest, "constraint digest");
  for (const item of manifest.currentRevisions) assertDigest(item.digest, "revision digest");
  for (const item of manifest.evidence) assertDigest(item.digest, "evidence digest");
  for (const item of manifest.memory) assertDigest(item.digest, "memory digest");
}

export function contextProjectionManifestDigest(manifest: ContextProjectionManifest): string {
  assertManifest(manifest);
  return sha256(canonicalJson(manifest));
}

export function renderedContextDigest(rendered: string): string {
  return sha256(rendered);
}

export function contextProjectionId(
  operationId: string,
  operationEpoch: number,
  manifestDigest: string,
): string {
  assertDigest(manifestDigest, "projection manifest digest");
  if (!operationId || !Number.isSafeInteger(operationEpoch) || operationEpoch < 1) {
    throw new Error("projection identity is invalid");
  }
  return sha256(`${operationId}\0${operationEpoch}\0${manifestDigest}`);
}

export function createContextProjection(input: CreateContextProjectionInput): ContextProjectionRecord {
  if (!input.workspaceId || !input.brandId || !input.jobId) throw new Error("projection tenant and job are required");
  if (!Number.isFinite(Date.parse(input.now))) throw new Error("invalid projection timestamp");
  assertDigest(input.renderedDigest, "rendered context digest");
  if (!ARTIFACT_ID.test(input.renderedArtifactId)) throw new Error("invalid rendered artifact id");
  if (!Number.isSafeInteger(input.renderedChars) || input.renderedChars < 1) {
    throw new Error("rendered context character count is invalid");
  }
  if (input.renderedChars > input.manifest.maxChars) {
    throw new Error("rendered context exceeds manifest budget");
  }
  const manifestDigest = contextProjectionManifestDigest(input.manifest);
  return {
    id: contextProjectionId(input.manifest.operationId, input.manifest.operationEpoch, manifestDigest),
    compilerVersion: input.manifest.compilerVersion,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    jobId: input.jobId,
    operationId: input.manifest.operationId,
    operationEpoch: input.manifest.operationEpoch,
    model: input.manifest.model,
    goalDigest: input.manifest.goalDigest,
    policyVersion: input.manifest.policyVersion,
    pinnedConstraintIds: input.manifest.pinnedConstraints.map((item) => item.id),
    approvalIds: [...input.manifest.approvalIds],
    unresolvedEffectIds: [...input.manifest.unresolvedEffectIds],
    currentRevisionRefs: input.manifest.currentRevisions
      .map((item) => `${item.kind}/${item.id}@${item.revision}`),
    evidenceRefs: input.manifest.evidence.map((item) => item.id),
    artifactRefs: [...new Set([...input.manifest.artifactRefs, input.renderedArtifactId])],
    recentEventIds: [...input.manifest.recentEventIds],
    manifest: structuredClone(input.manifest),
    manifestDigest,
    renderedDigest: input.renderedDigest,
    renderedChars: input.renderedChars,
    renderedArtifactId: input.renderedArtifactId,
    createdAt: input.now,
  };
}
