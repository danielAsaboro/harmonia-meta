"use client";

import { useEffect, useRef, useState } from "react";
import { browserLocalPersistence, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/dashboard/Button";
import { clientAuth } from "@/lib/firebaseClient";
import { establishPersistedIdentity, restorePersistedSession, shouldRestorePersistedSession } from "@/lib/sessionPersistence";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const interactiveSignIn = useRef(false);

  async function createServerSession(idToken: string): Promise<boolean> {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    return response.ok;
  }

  useEffect(() => {
    return onAuthStateChanged(clientAuth(), async (user) => {
      if (!user || interactiveSignIn.current) return;
      if (!shouldRestorePersistedSession(user.metadata.lastSignInTime)) {
        await firebaseSignOut(clientAuth());
        return;
      }
      setBusy(true);
      try {
        const restored = await restorePersistedSession(user, createServerSession);
        if (!restored) return;
        router.replace("/dashboard");
        router.refresh();
      } catch {
        // Keep the interactive Google option available when silent restoration fails.
      } finally {
        setBusy(false);
      }
    });
  }, [router]);

  async function signIn() {
    interactiveSignIn.current = true;
    setBusy(true);
    setError("");
    try {
      const modeResponse = await fetch("/api/auth/session", { cache: "no-store" });
      const mode = await modeResponse.json() as { devBypassEnabled?: boolean };
      if (mode.devBypassEnabled) {
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ devBypass: true }),
        });
        if (!response.ok) throw new Error("Could not create a local development session.");
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      const auth = clientAuth();
      const credential = await establishPersistedIdentity(
        () => setPersistence(auth, browserLocalPersistence),
        () => signInWithPopup(auth, new GoogleAuthProvider()),
      );
      const idToken = await credential.user.getIdToken();
      if (!await createServerSession(idToken)) throw new Error("Could not create a secure session.");
      router.replace("/dashboard");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google sign-in failed.");
    } finally {
      interactiveSignIn.current = false;
      setBusy(false);
    }
  }

  return (
    <main className={`${styles.shell} dashboard-app`}>
      <section className={styles.story} aria-label="About Harmonia">
        <Link className={styles.brand} href="/" aria-label="Harmonia home">
          <BrandMark className={styles.brandMark} decorative />
          <span>Harmonia</span>
        </Link>

        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>THE CONTENT OPERATING SYSTEM</p>
          <h1>Turn one source into a week of approved, publishable content.</h1>
          <p className={styles.intro}>
            Harmonia coordinates research, drafting, review, publishing, and verification—while keeping every material action behind your approval.
          </p>
        </div>

        <div className={styles.signal} aria-label="Workflow safeguards">
          <span><i aria-hidden /> Human approval required</span>
          <span>Auditable by design</span>
        </div>
      </section>

      <section className={styles.auth}>
        <div className={styles.authPanel} aria-busy={busy}>
          <div className={styles.panelHeading}>
            <p className={styles.eyebrow}>OPERATOR ACCESS</p>
            <h2>Create or open your workspace</h2>
            <p>Continue with the Google identity that owns your Harmonia workspace.</p>
          </div>

          {error && <p className={styles.error} role="alert">{error}</p>}

          <Button
            variant="primary"
            onClick={signIn}
            busy={busy}
            busyLabel="Signing in…"
            className={styles.googleButton}
          >
            <svg className={styles.googleLogo} viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285f4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.702-1.567 2.684-3.876 2.684-6.615Z" />
              <path fill="#34a853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.91-2.259c-.805.54-1.835.86-3.046.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
              <path fill="#fbbc05" d="M3.963 10.707A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332Z" />
              <path fill="#ea4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.43 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
            </svg>
            Continue with Google
          </Button>

          <p className={styles.privacy}>
            Jobs, connections, memory, assets, and publishing approvals remain isolated to your workspace.
          </p>

          <div className={styles.trustLine}>
            <span>Secure session</span>
            <span aria-hidden>•</span>
            <span>30-day sign-in</span>
          </div>
        </div>
      </section>
    </main>
  );
}
