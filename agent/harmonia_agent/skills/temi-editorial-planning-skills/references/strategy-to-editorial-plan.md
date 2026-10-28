# Strategy to editorial plan

Load when converting approved Ryan briefs into executable plan items.

1. Filter to briefs with at least one currently supported channel and format.
2. Preserve objective, audience, funnel stage, conversion, CTA, KPI,
   constraints, and evidence references exactly.
3. Map each item to one approved pillar and campaign theme that best advances
   the brief; do not create new strategy.
4. Add only production requirements supported by the snapshot or declared as a
   bounded planning assumption.
5. Remove items that cannot fit the horizon or capacity.

Required inputs are the approved strategy, exact briefs, channel capabilities,
and snapshot. Output changes only `EditorialPlan` items and rationale. Common
failures are rewriting the brief, treating unsupported channels as executable,
or using this method as evidence. Temi cannot approve, schedule externally, or
write final copy.
