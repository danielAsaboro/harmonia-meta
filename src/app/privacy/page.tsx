import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Harmonia",
  description: "How Harmonia handles identity, connected social accounts, content, and publishing data.",
};

const updated = "August 29, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16 text-slate-800 sm:px-10">
      <Link href="/" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
        ← Harmonia
      </Link>
      <header className="mt-10 border-b border-slate-200 pb-8">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Privacy Policy</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated {updated}</p>
      </header>

      <div className="space-y-9 py-10 text-base leading-7">
        <section>
          <h2 className="text-xl font-semibold text-slate-950">What Harmonia does</h2>
          <p className="mt-3">
            Harmonia is a multi-tenant content workflow for startups. A user signs in with Google,
            chooses a workspace, and may connect authorized LinkedIn, Instagram, YouTube, or other
            supported accounts. Harmonia prepares content and publishes only actions that an
            authorized operator has approved.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Information we process</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Google identity details needed to authenticate you, such as your name, email address, and account identifier.</li>
            <li>OAuth grants, account identifiers, pages, channels, and professional profiles you choose to connect.</li>
            <li>Source media, transcripts, drafts, approvals, publishing instructions, and generated assets you submit or create.</li>
            <li>Operational logs and receipts needed to secure, retry, audit, and verify requested publishing actions.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">How we use it</h2>
          <p className="mt-3">
            We use this information to provide authentication, isolate workspace data, analyze
            content, show destinations you control, execute approved actions through official
            platform APIs, verify their result, prevent duplicate publishing, and protect the
            service. We do not sell personal information or use connected-account content for
            advertising.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Connected platforms</h2>
          <p className="mt-3">
            Google, LinkedIn, Meta (including Instagram), and YouTube process information under
            their own terms and privacy policies. Harmonia requests only the permissions required
            for the feature you enable. You can revoke access with the provider or disconnect an
            account from Harmonia settings. Disconnecting prevents new actions with that grant.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Storage, sharing, and retention</h2>
          <p className="mt-3">
            Credentials are kept server-side and protected separately from public application
            code. We disclose data to infrastructure and API providers only as needed to operate a
            requested feature, comply with law, or protect the service. Workspace records are kept
            while the account is active and as needed for security, audit, dispute resolution, and
            legal obligations; connected credentials are removed or invalidated when disconnected.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Your choices</h2>
          <p className="mt-3">
            You may review connected destinations, disconnect provider access, or request that we
            delete your account and associated workspace data. Use the account and connection
            controls in Harmonia settings. If you cannot access the product, use the support
            channel shown on the Harmonia sign-in page. Provider-side content may need to be
            deleted directly on that provider after publication.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Changes</h2>
          <p className="mt-3">
            We may update this policy as Harmonia changes. The date above identifies the current
            version. Material changes will be presented through the product or this page.
          </p>
        </section>
      </div>
    </main>
  );
}
