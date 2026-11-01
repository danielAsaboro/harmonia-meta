# Context-first Harmonia intent routing

## Problem

Harmonia currently treats almost any substantial chat message as an isolated source job and asks advanced operators to name internal output enums such as `x_post` and `content_pack`. That is an implementation-shaped interface. A normal founder begins with a company, goals, audience, voice, and a desired outcome. Strategy, an editorial plan, and a calendar should become durable workspace context; individual source jobs should inherit that context.

## Product model

The chat surface accepts ordinary requests. Harmonia classifies them into one of these user-level intents:

- establish or revise the workspace content strategy;
- build or adjust the editorial plan and calendar;
- repurpose supplied source material;
- create a context-aware one-off item;
- inspect status, work, or evidence;
- request an external effect, which remains behind the existing approval boundary;
- converse or ask for help.

Internal output kinds remain a typed execution detail. The router infers a bounded set from channel and format language, records assumptions, and never exposes enum syntax as a requirement.

## Ownership and boundaries

The Harmonia Google ADK service owns routing. A filesystem skill named `harmonia-intent-routing` contains the routing policy and examples. A typed router agent loads that skill and returns a strict `IntentRoute` contract. The Next.js control plane supplies a compact, workspace-scoped context snapshot and validates the response again before executing deterministic handlers.

The model may classify and infer. Deterministic code retains authority over identifiers, tenant scope, supported output kinds, source rights, approvals, and external effects.

## Durable context

The control plane builds `WorkspaceContentContext` from existing durable state:

- operator goals and strategy context;
- the latest approved content strategy;
- the latest editorial plan;
- upcoming persisted calendar/content items;
- recent jobs and pending approval counts.

Each request carries readiness flags (`strategy`, `plan`, `calendar`) and small summaries, not raw provider responses or private source bodies. One-off work inherits approved strategy and plan context where available. When the workspace has no strategy, Harmonia can still run a bounded one-off with explicit assumptions; requests for an ongoing program route to strategy setup first.

## Natural output inference

The router returns user concepts (`short social post`, `professional post`, `article`, `newsletter`, `carousel`, `image`, `short video`, `calendar`, `content package`). The control plane maps them to supported internal output kinds. Ambiguous requests use conservative defaults based on the requested channel and current strategy. No user must type registry identifiers.

## Source autonomy and questions

URLs and attachments are treated as candidate sources and are acquired through the existing source-manifest pipeline. Extraction, transcription, analysis, and fit against strategy are autonomous. Harmonia asks only for a missing fact that prevents a safe route or for an authority boundary such as media rights or publishing approval. It does not ask the user to choose internal stages or output tags.

## Interface behavior

The empty chat state leads with founder-language examples: establish a strategy from a company site, plan the next month, repurpose a video, or make a one-off announcement. When a strategy or plan exists, the response states that the new job is using that context. Strategy/plan/calendar requests receive a focused next action instead of being silently converted into a pasted-text source job.

## Failure behavior

Routing fails closed when the ADK service is unavailable or returns an invalid contract. The UI reports that Harmonia could not understand the request and preserves the message; it does not silently run a local heuristic that could create the wrong effect. Existing explicit approval gates remain unchanged.

