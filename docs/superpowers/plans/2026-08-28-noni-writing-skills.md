# Noni Writing Skills Implementation Plan

1. Write failing tests for skill discovery, all ten reference topics, the
   dedicated toolset, and fail-closed skill/resource trajectories.
2. Add the filesystem skill and original reference modules with a complete
   coverage manifest.
3. Wire the skill toolset and trace validator into Noni while preserving the
   strict content-draft validator and bounded Dara loop.
4. Write failing model-policy tests, then cleanly move Noni from the custom
   Gemma endpoint to Gemini 3.5 Flash and remove obsolete configuration.
5. Add behavioral evaluation fixtures for the ten writing modes, missing
   evidence, skill-as-evidence, authority overreach, and bounded revision.
6. Update agent, model, deployment, architecture, and Noni reference docs.
7. Run focused and complete Python/Vitest suites, lint, TypeScript checking,
   production build, and final diff review; commit the isolated branch without
   merging it.
