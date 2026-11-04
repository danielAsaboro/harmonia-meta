import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefSummary } from "@/components/onboarding/BriefSummary";
import { readSharedBrief } from "@/lib/briefShares";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Brand brief — Harmonia", robots: { index: false, follow: false } };

export default async function SharedBriefPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await readSharedBrief(token);
  if (!shared) notFound();
  return (
    <main className="min-h-dvh bg-[#c9c5bc] px-4 py-10 text-[#11110f] sm:py-16">
      <article className="mx-auto w-full max-w-[720px] rounded-[18px] border border-[#11110f] bg-white p-6 shadow-[4px_4px_0_#11110f] sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{shared.brief.brief.company}</h1>
        <p className="mt-1 text-xs text-black/50">Brand brief by Harmonia · {new Date(shared.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
        <div className="mt-6"><BriefSummary brief={shared.brief} /></div>
      </article>
    </main>
  );
}
