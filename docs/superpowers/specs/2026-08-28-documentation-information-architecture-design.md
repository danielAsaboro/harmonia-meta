# Documentation information architecture design

> **Historical design — superseded 2026-08-28.** Navigation counts and proposed structure here are a decision record, not the current site inventory. `docs/docs.json` and [`docs/index.mdx`](../../index.mdx) are authoritative.

Harmonia's public documentation uses six short reader-goal tabs: Product,
Guides, Agents, Platform, Operations, and Reference. Each tab opens with a
purpose-built landing page. Groups organize related pages; internal plans and
specifications remain outside public navigation.

Reference material describes exact configuration, APIs, contracts, state,
permissions, limits, failures, and evidence status. Product and Operations
pages explain architecture and rationale; Guides remain task-oriented. Agent
and Platform pages use consistent responsibility, authority, failure,
verification, source-map, and related-page sections.

Documentation CI parses the real Mintlify configuration and public pages. It
rejects missing or duplicate navigation entries, broken internal links,
orphaned public pages, duplicate titles, incomplete frontmatter, unresolved
source-file references, internal records in public navigation, and missing
evidence-status sections on platform reference pages.

Reusable Mermaid diagrams cover production flow, authority boundaries, state
ownership, effect lifecycle, agent handoffs, and deployment. A glossary and
evaluation path provide stable entry points for readers and judges.
