# Capacity, dependencies, and deadlines

Load when feasibility depends on throughput, assets, blockers, or lead time.

1. Read capacity, asset readiness, and blocked dependencies from the snapshot.
2. Cap total and weekly items before assigning dates.
3. Represent only real plan-item dependencies and keep the graph acyclic.
4. Put every production deadline before its publication window with realistic
   room for required assets.
5. Exclude blocked items from next-item selection and lower confidence where
   readiness is unknown.

Outputs are dependencies, deadlines, required assets, and feasibility
rationale. Missing readiness is uncertainty, not proof of readiness. Temi may
not create assets, unblock work, or mutate production state.
