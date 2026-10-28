---
name: trend-scan
description: >-
  Turn live startup-tech signals into grounded trend angles for social posts.
  Use when asked for trend context, timely angles, or what the market is
  talking about right now.
---

# Trend Scan

Produce trend angles that cite current, verifiable signals.

## Workflow

1. Call `fetch_trend_signals` for a broad current scan, or
   `search_trend_signals` for a specific topic. Use one data tool unless its
   first attempt returns a retryable error.
2. Select at most three signals that genuinely connect to the operator's
   product, audience, or prior content.
3. For each connection, state one angle: why now (points/comments momentum),
   who cares (startup audience), and what our take is.
4. Never present a signal you did not fetch this turn. If `fetch_trend_signals`
   fails or returns empty, say so plainly and stop — do not recall trends from
   memory.

## Evidence rules

See references/evidence-rules.md for citation and honesty requirements.

## Tool envelope and escalation

Use only successful tool data. Cite each selected story with its exact
`evidenceId` and display the ID; dataset evidence alone cannot support a
story-specific claim. Return `no_data` for a successful empty scan. Retry once
only when `error.retryable=true`; otherwise preserve the typed error and stop.
Never approve, publish, retry jobs, alter credentials or budgets, or mutate.
