import type { StoredBrandBrief } from "@/lib/brandBrief";

export const BRAND_CONTEXT_MAX_CHARS = 1500;

/** The onboarded brief as compact prompt context: company, positioning, each customer's top pains, voice. */
export function brandBriefContext(stored: StoredBrandBrief | undefined): string | undefined {
  if (!stored) return undefined;
  const brief = stored.brief;
  const text = [
    `Company: ${brief.company}. Positioning: ${brief.positioning}`,
    ...brief.audiences.map((audience) => `Customer ${audience.id} (${audience.name}) pains: ${audience.pains.slice(0, 3).join("; ")}`),
    ...(brief.voiceRules.length ? [`Voice: ${brief.voiceRules.join("; ")}`] : []),
  ].join("\n");
  return text.length <= BRAND_CONTEXT_MAX_CHARS ? text : `${text.slice(0, BRAND_CONTEXT_MAX_CHARS - 1)}…`;
}
