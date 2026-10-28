import { z } from "zod";

// Provider-observed evidence from one Meta Model API web search request: the
// completed `web_search_call` count, raw search results, and `url_citation`s.
export const searchProvenanceSchema = z.object({
  provider: z.literal("meta"),
  responseId: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  searchCalls: z.number().int().min(1),
  results: z.array(z.object({
    url: z.string().min(1).max(2000), title: z.string().max(500), snippet: z.string().max(2000),
  }).strict()).max(20),
  citations: z.array(z.object({
    url: z.string().min(1).max(2000), title: z.string().max(500), citedText: z.string(),
  }).strict()),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
}).strict();

export type SearchProvenance = z.infer<typeof searchProvenanceSchema>;

export interface CitedSource { evidenceId: string; title: string; url: string; supportedText: string }

const normalized = (value: string) => value.replace(/\s+/g, " ").trim();

/** Fail closed unless every model-cited source appears in Meta's results or citations. */
export function assertSourcesInSearchProvenance(
  sources: CitedSource[], provenance: SearchProvenance, label: string,
): void {
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.evidenceId)) throw new Error(`duplicate ${label} search evidence`);
    seen.add(source.evidenceId);
    const items = [
      ...provenance.results.filter((item) => item.url === source.url).map((item) => [item.title, item.snippet]),
      ...provenance.citations.filter((item) => item.url === source.url).map((item) => [item.title, item.citedText]),
    ];
    const titled = items.some(([title]) => normalized(title) === normalized(source.title));
    const supported = items.some(([, text]) => normalized(text).includes(normalized(source.supportedText)));
    if (!titled || !supported) throw new Error(`${label} source absent from web search provenance`);
  }
}
