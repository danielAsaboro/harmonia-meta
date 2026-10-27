import type { OutputKind } from "./types";

export interface OutputCapability {
  state: "verified_export" | "publish_when_connected" | "unavailable";
  requiresTimedVideo: boolean;
  requiresVerbatimQuote: boolean;
  approvalClass: "strategy" | "effect";
  costClass: "local" | "provider_metered";
  publisher?: "x" | "linkedin";
}

const exportable = { state: "verified_export", requiresTimedVideo: false, requiresVerbatimQuote: false, approvalClass: "strategy", costClass: "local" } as const;
export const OUTPUT_CAPABILITIES: Record<OutputKind, OutputCapability> = {
  x_post: { ...exportable, state: "publish_when_connected", approvalClass: "effect", publisher: "x" },
  x_thread: { ...exportable, state: "publish_when_connected", approvalClass: "effect", publisher: "x" },
  linkedin_post: { ...exportable, state: "publish_when_connected", approvalClass: "effect", publisher: "linkedin" },
  blog_article: exportable, newsletter: exportable, caption: exportable, carousel_spec: exportable,
  social_image: { ...exportable, costClass: "provider_metered" },
  quote_card: { ...exportable, requiresVerbatimQuote: true }, diagram: exportable,
  short_clip: { ...exportable, requiresTimedVideo: true, approvalClass: "effect" }, reel: { ...exportable, requiresTimedVideo: true, approvalClass: "effect" },
  generated_video: { ...exportable, state: "unavailable", approvalClass: "effect", costClass: "provider_metered" },
  generated_music: { ...exportable, state: "unavailable", approvalClass: "effect", costClass: "provider_metered" },
  editorial_calendar: exportable, content_pack: exportable,
};

export function availableOutputKinds(context: { hasTimedVideo: boolean; hasVerbatimQuote: boolean }): OutputKind[] {
  return (Object.entries(OUTPUT_CAPABILITIES) as Array<[OutputKind, OutputCapability]>).filter(([, capability]) => capability.state !== "unavailable" && (!capability.requiresTimedVideo || context.hasTimedVideo) && (!capability.requiresVerbatimQuote || context.hasVerbatimQuote)).map(([kind]) => kind);
}
