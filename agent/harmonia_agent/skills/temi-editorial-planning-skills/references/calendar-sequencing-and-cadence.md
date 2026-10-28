# Calendar sequencing and cadence

Load when placing publication windows across the approved horizon.

1. Read commitments and verified posting-window observations from the exact
   snapshot.
2. Exclude occupied channel windows before ranking candidate windows.
3. Apply minimum spacing and weekly channel ceilings.
4. Prefer verified windows only when their evidence matches channel and format;
   otherwise use a lower-confidence bounded assumption.
5. Explain the sequence as campaign logic, not merely chronological sorting.

Inputs are horizon, timezone, commitments, cadence limits, and observations.
Output is collision-free UTC windows plus cadence rationale. Do not invent
performance data, calendar availability, or claim an external event exists.
