# Demo History Origin Design

## Purpose

Create a clearly isolated teaching-demo history inside the existing Harmonia tenant. The copied history begins at `2026-08-27T00:00:00.000Z`, preserves all relative intervals, remains visible to the existing operator, and cannot execute providers, publications, messages, billing, or retries. Source production records and objects remain unchanged.

## Scope

The operator utility copies every source job in one workspace/brand into a named demo dataset. It copies each job aggregate and every descendant document. It also copies brand-scoped documents whose stored `jobId` matches a copied job, including production plans, claims, receipts, actions, artifacts, and related records discoverable through Firestore collection traversal.

The utility does not copy credentials, OAuth connections, Telegram connections, workspace membership, scheduler configuration, active autonomy configuration, or unscoped brand records.

## Isolation

Copied job IDs are deterministic hashes of the demo dataset ID and source job ID. Brand-scoped associated document IDs are deterministic hashes of their source paths. Descendant document IDs can remain unchanged because their copied job parent is unique.

A manifest is written at:

`workspaces/{workspaceId}/brands/{brandId}/demo_datasets/{datasetId}`

The manifest records the source scope, anchor, source minimum timestamp, applied offset, copied record counts, source-path-to-demo-path mappings, creation time, and `teaching_demo` provenance.

Every copied document receives a `demoProvenance` object containing the dataset ID, source document path, origin anchor, and `teaching_demo` label. Existing provenance is preserved.

## Timeline Transformation

The utility discovers every ISO-8601 string and Firestore Timestamp within the selected job graph. The earliest discovered instant becomes `2026-08-27T00:00:00.000Z`. The same millisecond offset is applied recursively to all other timestamps, including nested arrays and objects. Durations and ordering therefore remain unchanged.

Plain strings that are not complete ISO timestamps are never altered. Object names, digests, provider IDs, costs, and content are unchanged.

## Side-Effect Quarantine

Copied records are historical display data only:

- Executable outbox, inbox, command, claim, lease, recovery, scheduler, and effect records are not copied as live records.
- Their historical representations are stored beneath the demo manifest in `records`, with original state and shifted times, rather than in collections watched by workers.
- Copied jobs are forced to terminal display state while their original status and stage are retained in `demoProvenance`.
- External object keys remain read-only references to the original immutable objects; no provider or storage copy is performed.

This prevents the demo dataset from being claimed by Cloud Run or Pub/Sub.

## Execution Contract

The utility has two phases:

1. `--dry-run` discovers the graph and prints source counts, earliest timestamp, offset, destination paths, and rejected/unsafe records without writing.
2. `--apply` repeats discovery, verifies the dry-run digest supplied by the operator, and creates the dataset atomically in bounded Firestore batches. Existing destination documents cause the run to stop rather than overwrite.

The first implementation targets the currently authenticated Harmonia workspace and brand, with source and destination scope supplied explicitly on the command line. It never changes the operator's default workspace or brand.

## Validation

Pure transformation tests cover ISO strings, Firestore Timestamps, nested arrays, unchanged non-time strings, deterministic IDs, and preserved intervals. Firestore emulator integration tests cover recursive job copying, associated-record selection, manifest creation, collision refusal, source immutability, and quarantine of executable records.

After applying to the live tenant, a read-only verification pass must prove:

- source document digests are unchanged;
- every copied job is marked as a teaching demo;
- the minimum copied timestamp equals the August 27 anchor;
- all relative intervals match their sources;
- no demo record exists in a worker-watched executable collection;
- the manifest count and digest match the copied graph.

## Recovery

Because the utility only creates new demo-scoped records, recovery is deletion of the exact dataset manifest and copied paths listed in its mapping. The utility will emit, but not automatically run, a bounded cleanup command. No source record is modified during creation or cleanup.
