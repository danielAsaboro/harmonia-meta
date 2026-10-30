import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Harmonia",
  description: "The terms that govern use of Harmonia's approval-gated content workflow.",
};

const updated = "August 29, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16 text-slate-800 sm:px-10">
      <Link href="/" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
        ← Harmonia
      </Link>
      <header className="mt-10 border-b border-slate-200 pb-8">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Terms of Service</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated {updated}</p>
      </header>

      <div className="space-y-9 py-10 text-base leading-7">
        <section>
          <h2 className="text-xl font-semibold text-slate-950">Using Harmonia</h2>
          <p className="mt-3">
            Harmonia helps authorized startup teams prepare, approve, publish, and verify social
            content. You must provide accurate account information, protect access to your
            workspace, and use the service only for accounts and content you are authorized to
            manage.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Connected accounts and approval</h2>
          <p className="mt-3">
            Connecting a social account authorizes Harmonia to request the selected permissions
            through official platform APIs. Harmonia requires human approval before publishing.
            You remain responsible for the content, destination, timing, and consequences of every
            approved action made through your connected account.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Acceptable use</h2>
          <p className="mt-3">
            Do not use Harmonia to violate law, platform rules, intellectual-property rights,
            privacy rights, or another person&apos;s authorization. Do not attempt to bypass approval
            controls, security limits, provider restrictions, or service safeguards.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Availability and third parties</h2>
          <p className="mt-3">
            Social platforms and infrastructure providers are independent services. Their outages,
            reviews, permission changes, rate limits, and terms can affect Harmonia. We do not
            guarantee uninterrupted access or that a third-party platform will accept or retain a
            requested publication.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Suspension and termination</h2>
          <p className="mt-3">
            You may stop using Harmonia and revoke provider access at any time. We may restrict
            access when reasonably necessary to protect users, platforms, or the service, or to
            address suspected misuse. Obligations that by their nature survive termination remain
            in effect.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Privacy and changes</h2>
          <p className="mt-3">
            Our <Link href="/privacy" className="font-semibold underline">Privacy Policy</Link>{" "}
            explains how Harmonia processes information. We may update these terms as the service
            changes; the date above identifies the current version.
          </p>
        </section>
      </div>
    </main>
  );
}
