import { createHash } from "node:crypto";
import { canonicalJson } from "../recordReplay/integrity";
import type { ContentArtifact, ContentArtifactPayload } from "./contracts";

export function contentArtifactDigest(artifact: Omit<ContentArtifact, "contentDigest"> | ContentArtifact): string {
  const { contentDigest: _ignored, ...meaning } = artifact as ContentArtifact;
  return createHash("sha256").update(canonicalJson(meaning)).digest("hex");
}

export function sealContentArtifact(artifact: Omit<ContentArtifact, "contentDigest">): ContentArtifact {
  return { ...artifact, contentDigest: contentArtifactDigest(artifact) } as ContentArtifact;
}

/**
 * Resolve a proposed pack manifest at the trusted persistence boundary.
 * Agents identify children; only the host may copy their canonical digests.
 */
export function resolveContentPackPayload(
  proposed: Extract<ContentArtifactPayload, { kind: "content_pack" }>,
  sealedChildren: readonly ContentArtifact[],
): Extract<ContentArtifactPayload, { kind: "content_pack" }> {
  const expectedIds = sealedChildren.map((artifact) => artifact.id);
  const proposedIds = proposed.artifacts.map((artifact) => artifact.artifactId);
  if (
    new Set(proposedIds).size !== proposedIds.length
    || proposedIds.length !== expectedIds.length
    || expectedIds.some((id) => !proposedIds.includes(id))
  ) {
    throw new Error("content pack must reference every other accepted artifact exactly once");
  }
  const sealedById = new Map(sealedChildren.map((artifact) => [artifact.id, artifact] as const));
  return {
    kind: "content_pack",
    artifacts: proposedIds.map((artifactId) => ({
      artifactId,
      digest: sealedById.get(artifactId)!.contentDigest,
    })),
  };
}
