# Maya Presenter Refinement Design

Maya is Harmonia's tool-free presentation specialist. It converts a bounded `UiContext` catalog
into a small reference-only `SurfacePlan`; it never supplies domain truth, controls, effects, or
workflow decisions. The authenticated host resolves every reference from Firestore-backed job
state and emits trusted A2UI operations.

The clean-cut output vocabulary contains only domain views: campaign brief, job progress, moment
explorer, draft comparison, platform preview, source evidence, approval review, and verification
receipt. Loading, empty, unresolved, and failure states belong exclusively to deterministic host
code. Each domain node must name the exact active job and only the entity-reference fields its
component consumes.

Before an output can be hydrated or persisted, matching Python and TypeScript validators reject
unknown IDs, wrong jobs, duplicate references, component/reference mismatches, authoritative
titles, unsafe approval surfaces, non-pending approval actions, and invalid graphs. ApprovalReview
is allowed only in the approval slot for exactly one supplied pending action. Domain content,
approval risk/state, payloads, receipts, verification, URLs, and consequences are always hydrated
from persisted truth.

Maya has no tools. It cannot approve, reject, schedule, publish, execute, verify, create receipts,
mutate workflow state, or manufacture a lifecycle placeholder that implies any of those outcomes.
