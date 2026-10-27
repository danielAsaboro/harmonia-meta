import type { ContentArtifact } from "./contracts";

export function contentArtifactPreview(artifact: ContentArtifact): string {
  const payload = artifact.payload;
  switch (payload.kind) {
    case "x_post": return payload.text;
    case "x_thread": return payload.posts.map((post, index) => `${index + 1}. ${post.text}`).join("\n\n");
    case "linkedin_post": return [payload.title, payload.body, payload.cta].filter(Boolean).join("\n\n");
    case "blog_article": return [payload.headline, payload.dek, ...payload.sections.map((section) => `${section.heading}\n${section.body}`), payload.conclusion, payload.cta].join("\n\n");
    case "newsletter": return [`Subject: ${payload.subject}`, `Preheader: ${payload.preheader}`, payload.introduction, ...payload.sections.map((section) => `${section.heading}\n${section.body}`), payload.cta, payload.signOff].filter(Boolean).join("\n\n");
    case "caption": return [payload.text, payload.cta, payload.hashtags.join(" ")].filter(Boolean).join("\n\n");
    case "carousel_spec": return payload.slides.map((slide, index) => `Slide ${index + 1} — ${slide.headline}\n${slide.body}`).join("\n\n");
    case "quote_card": return `“${payload.quote}”\n— ${payload.attribution}\n\n${payload.renderBrief}`;
    case "diagram": return [`${payload.diagramType} diagram`, ...payload.nodes.map((node) => `${node.id}: ${node.label}`), ...payload.edges.map((edge) => `${edge.from} → ${edge.to}${edge.label ? `: ${edge.label}` : ""}`), payload.renderBrief].join("\n");
    case "editorial_calendar": return payload.entries.map((entry) => `${entry.intendedAt} · ${entry.channel} · ${entry.artifactId}\n${entry.purpose}`).join("\n\n");
    case "content_pack": return payload.artifacts.map((item) => `${item.artifactId} · ${item.digest}`).join("\n");
  }
}
