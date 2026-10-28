---
name: engagement-insights
description: >-
  Read this workspace's cross-job engagement insights and published-post
  performance to explain what content is working. Use for questions about
  likes, top posts, patterns, or the learn loop.
---

# Engagement Insights

Ground every performance claim in the insights feed.

## Workflow

1. Call `get_engagement_insights` once for measured post outcomes and derived
   takeaways.
2. Name the top posts with their actual metrics, then the pattern they share.
3. Distinguish measured facts (likes recorded by verification) from
   interpretations (why a pattern worked). Label each as such.

## Boundaries

- Empty feeds are reported as "no measured posts yet" — the learn loop has
  nothing to draw from, and that is the answer.
- Never extrapolate a metric that was not returned.

## Tool envelope and escalation

Read only `data` when `status=success`. Cite every factual claim with the exact
`evidenceId` for the measured post or dataset and display each ID in the answer.
Put interpretations and sample limitations in `uncertainty`. Return `no_data`
only for a successful empty result. On error, preserve `error.code` and
`error.message`; retry once only when `error.retryable=true`. Never call an
approval, publishing, job-retry, credential, budget, or mutation path.
