# Repository Agent Rules

## Compatibility Policy

- Do not preserve backward compatibility unless the user explicitly requests a migration path.
- When a feature, route, interface, or behavior is replaced, remove the obsolete implementation rather than retaining redirects, aliases, adapters, shims, duplicate entry points, or legacy fallbacks.
- Update all internal links, tests, and documentation to the replacement in the same change.
- Do not introduce compatibility code speculatively.
