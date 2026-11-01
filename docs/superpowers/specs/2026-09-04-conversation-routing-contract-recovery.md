# Conversation Routing and Contract Recovery Design

## Goal

Make every dashboard conversation directly addressable and prevent valid, complete cross-runtime evidence from failing against obsolete persistence bounds.

## Conversation routing

- `/dashboard` remains the entry route.
- A selected or newly created conversation uses `/dashboard/{conversationId}`.
- Deep links load that exact conversation, while New and Past Chats update browser history so refresh and back/forward preserve operator context.
- Every `/dashboard/...` conversation route uses the studio shell rather than the generic dashboard page shell.

## Contract recovery

- Preserve every authoritative evidence identifier passed from Python to TypeScript; never truncate it to satisfy an obsolete downstream limit.
- Align the strategy invocation context schema with the already-supported source-analysis evidence bounds.
- Convert internal payload validation failures into a safe typed error containing the endpoint and rejected field paths/count constraints, without source content.
- Retry only transient provider or dependency failures. Deterministic schema mismatches fail closed with an actionable error and require a corrected deployment before replay.
- Add cross-runtime regression fixtures large enough to exercise realistic multi-segment video evidence.

## Verification

- Prove canonical conversation deep-link, New, Past Chats, refresh, and back/forward behavior with focused tests.
- Prove a strategy context containing the live job's 53 evidence identifiers passes validation.
- Prove invalid internal payloads return safe field-level diagnostics.
- Run the complete web and Python suites and production build, deploy the changed services, then retry job `bc179238-95b6-4b35-8561-67035278cb01` through the normal recovery route.
