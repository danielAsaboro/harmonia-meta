import type { ContentArtifact } from "./contracts";
import type { ActionSeed } from "../policy";

type Destination = { kind: "linkedin_member" | "linkedin_organization"; id: string };

export function deriveArtifactActions(artifacts: ContentArtifact[], connections: { x: boolean; linkedinDestination: Destination | null }): ActionSeed[] {
  const ordered = [...artifacts].sort((left, right) => Number(left.payload.kind === "content_pack") - Number(right.payload.kind === "content_pack"));
  const actions: ActionSeed[] = ordered.map((artifact) => ({ id: `export-${artifact.id}-${artifact.contentDigest.slice(0, 12)}`, jobId: artifact.jobId, type: "export_content_artifact", title: `Export ${artifact.title}`, description: `Write and independently verify ${artifact.outputType.replaceAll("_", " ")} Markdown and JSON.`, payload: { type: "export_content_artifact", artifactId: artifact.id, artifactDigest: artifact.contentDigest, outputType: artifact.outputType } }));
  for (const artifact of artifacts) {
    if (artifact.payload.kind === "x_post" && connections.x) actions.push({ id: `publish-${artifact.id}-${artifact.contentDigest.slice(0, 12)}`, jobId: artifact.jobId, type: "publish_x_post", title: artifact.title, description: "Publish the exact accepted X artifact after approval.", payload: { type: "publish_x_post", artifactId: artifact.id, artifactDigest: artifact.contentDigest, text: artifact.payload.text } });
    if (artifact.payload.kind === "x_thread" && connections.x) actions.push({ id: `publish-${artifact.id}-${artifact.contentDigest.slice(0, 12)}`, jobId: artifact.jobId, type: "publish_x_thread", title: artifact.title, description: "Publish the exact accepted X thread after approval.", payload: { type: "publish_x_thread", artifactId: artifact.id, artifactDigest: artifact.contentDigest, posts: artifact.payload.posts } });
    if (artifact.payload.kind === "linkedin_post" && connections.linkedinDestination) actions.push({ id: `publish-${artifact.id}-${artifact.contentDigest.slice(0, 12)}`, jobId: artifact.jobId, type: "publish_linkedin_post", title: artifact.title, description: "Publish the exact accepted LinkedIn artifact to the selected destination after approval.", payload: { type: "publish_linkedin_post", artifactId: artifact.id, artifactDigest: artifact.contentDigest, body: artifact.payload.body, destination: connections.linkedinDestination } });
  }
  return actions;
}
