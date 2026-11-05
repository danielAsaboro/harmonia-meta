import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunReplay } from "@/components/proof/RunReplay";
import { loadPublicRun } from "@/lib/proof";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Replay a recorded run — Harmonia",
  description: "Step through a real Harmonia campaign run on Meta Model API, event by event, with its cost as it accrues.",
};

export default async function RunReplayPage({ params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const loaded = await loadPublicRun(bundleId);
  if (!loaded) notFound();
  const { run, steps } = loaded;
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-12 text-slate-800 sm:px-10">
      <Link href="/proof#runs" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← All recorded runs</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-950">Replay a recorded run</h1>
      <p className="mt-2 text-sm text-slate-600">
        Every event below was recorded from a real run on Meta Model API on {new Date(run.capturedAt).toUTCString()} and is replayed from its signed bundle,
        re-verified on this request (integrity <code className="font-mono text-xs">{run.integrityDigest.slice(0, 12)}</code>). Nothing here calls a model or spends budget.
      </p>
      <RunReplay steps={steps} durationMs={run.durationMs} />
    </main>
  );
}
