# Context-first intent routing implementation plan

1. Add failing Python contract tests for a strict Harmonia `IntentRoute`, workspace-context schema, and forbidden effect authorization; implement the models.
2. Add the `harmonia-intent-routing` filesystem skill and tests proving it loads through Google ADK; implement the router agent and authenticated `/internal/agent/route` endpoint.
3. Add failing TypeScript client tests for the route boundary; implement the authenticated Cloud Run client and runtime response validation.
4. Add failing tests for workspace-context projection from goals, approved strategy, editorial plan, calendar, jobs, and approvals; implement the read-only projection.
5. Replace direct web-layer Gemini parsing with Harmonia routing. Add failing chat-handler tests for strategy-first requests, contextual one-offs, natural output inference, source jobs, and unchanged approval boundaries; implement deterministic dispatch.
6. Update chat onboarding copy and tests so normal users see outcome language rather than internal output tags.
7. Run focused Python and TypeScript tests, then the complete suites, typecheck, build, and diff checks. Review the isolated branch without deploying or touching frozen submission artifacts.
