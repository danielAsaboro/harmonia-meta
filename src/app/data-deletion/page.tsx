import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "User Data Deletion — Harmonia",
  description: "How to disconnect Meta accounts and request deletion of Harmonia user data.",
};

const updated = "August 29, 2026";

export default function DataDeletionPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16 text-slate-800 sm:px-10">
      <Link href="/" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
        ← Harmonia
      </Link>
      <header className="mt-10 border-b border-slate-200 pb-8">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">User Data Deletion</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated {updated}</p>
      </header>

      <div className="space-y-9 py-10 text-base leading-7">
        <section>
          <h2 className="text-xl font-semibold text-slate-950">Disconnect Meta access</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6">
            <li>Open Harmonia settings and select the connected-accounts section.</li>
            <li>Choose the Facebook Page or Instagram professional account you connected.</li>
            <li>Select disconnect to prevent new actions and invalidate the stored grant.</li>
          </ol>
          <p className="mt-3">
            You can also remove Harmonia from Facebook&apos;s Apps and Websites settings. Removing the
            app at Meta prevents future API access but does not itself remove records held in your
            Harmonia workspace.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Request workspace-data deletion</h2>
          <p className="mt-3">
            Sign in with the Google identity that owns the workspace and use the account controls
            in Harmonia settings to request deletion. If you cannot access the product, use the
            support channel shown on the Harmonia sign-in page and identify the workspace and Meta
            account you want removed. We may verify ownership before acting on the request.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">What the request covers</h2>
          <p className="mt-3">
            A verified request removes or de-identifies the applicable account profile, stored
            OAuth grants, connected-account identifiers, drafts, approvals, and workspace records,
            except information we must retain temporarily for security, audit, dispute resolution,
            or legal obligations. Provider-side published content is not deleted automatically;
            remove that published content directly on Facebook or Instagram.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">More information</h2>
          <p className="mt-3">
            See the <Link href="/privacy" className="font-semibold underline">Privacy Policy</Link>{" "}
            for details about processing, retention, and connected platforms.
          </p>
        </section>
      </div>
    </main>
  );
}
