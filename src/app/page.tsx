import Link from "next/link";

import { BrandMark } from "@/components/BrandMark";
import { ApprovalDemo } from "@/components/landing/ApprovalDemo";
import { LiveWorkflow } from "@/components/landing/LiveWorkflow";
import { ReturnGlobe } from "@/components/landing/ReturnGlobe";
import { SignalWorld } from "@/components/landing/SignalWorld";
import { WorkflowMorph } from "@/components/landing/WorkflowMorph";

export default function LandingPage() {
  return (
    <main className="landing-shell">
      <section className="hero-section">
        <SignalWorld />
        <div className="hero-grain" aria-hidden="true" />

        <header className="landing-nav">
          <Link href="/" className="brand-pill" aria-label="Harmonia home">
            <BrandMark className="brand-mark" decorative />
            <span>Harmonia</span>
          </Link>
          <nav className="nav-island" aria-label="Primary navigation">
            <a href="#workflow">Workflow</a>
            <a href="#outputs">Outputs</a>
            <a href="#proof">Proof</a>
          </nav>
          <Link href="/dashboard" className="nav-cta">
            Open studio <span>↗</span>
          </Link>
        </header>

        <div className="hero-copy">
          <span className="eyebrow-pill">
            <i /> The content agent that closes the loop
          </span>
          <h1>
            One source.
            <span>A living system of content.</span>
          </h1>
          <p>
            Harmonia finds the signal across your source material, shapes it into platform-native
            content, waits for your approval, then publishes and proves what happened.
          </p>
          <div className="hero-actions">
            <Link href="/dashboard" className="primary-button">
              Start a content run <span>↗</span>
            </Link>
            <a href="#workflow" className="ghost-button">
              Watch it transform <span>↓</span>
            </a>
          </div>
          <span className="hero-source-types">Video · audio · documents · webpages · text</span>
        </div>

        <div className="source-card glass-card">
          <span className="card-kicker">SOURCE / 01</span>
          <div className="source-preview">
            <span className="play-dot">▶</span>
            <div className="wave-mini" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => (
                <i key={index} style={{ height: `${20 + ((index * 17) % 68)}%` }} />
              ))}
            </div>
          </div>
          <div className="card-row">
            <strong>Founder story.mp4</strong>
            <span>16:42</span>
          </div>
        </div>

        <div className="signal-card glass-card">
          <span className="pulse-ring" />
          <div>
            <span className="card-kicker">SIGNAL FOUND</span>
            <strong>7 moments worth sharing</strong>
          </div>
        </div>

        <div className="hero-status">
          <span>01 / 08</span>
          <span className="status-line"><i /></span>
          <span>SCROLL TO FOLLOW THE SIGNAL</span>
        </div>
      </section>

      <WorkflowMorph />

      <LiveWorkflow />

      <section id="outputs" className="outputs-section">
        <div className="section-intro section-intro-wide">
          <span className="section-index">02 — THE CONTENT ATELIER</span>
          <h2>One insight. Every shape it needs.</h2>
          <p>
            Harmonia doesn&apos;t paste the same caption everywhere. It preserves the idea while the
            format, crop, pacing, hook, and voice adapt to each platform.
          </p>
        </div>

        <div className="atelier-rail">
          <article className="output-card output-video">
            <header><span>SHORT / 9:16</span><b>00:42</b></header>
            <div className="video-frame">
              <span className="caption-line">Stop chasing reach.</span>
              <span className="caption-line accent">Start hearing signal.</span>
              <i className="video-play">▶</i>
              <div className="safe-zone">SAFE CROP</div>
            </div>
            <footer><strong>Founder lesson</strong><span>Auto-captioned · reframed</span></footer>
          </article>

          <article className="output-card output-thread">
            <header><span>THREAD / X</span><b>6 POSTS</b></header>
            <div className="thread-sheet">
              <span className="platform-avatar dark">𝕏</span>
              <p><strong>We nearly killed our launch by trying to be everywhere.</strong></p>
              <p>Then one customer conversation changed the entire content strategy. Here&apos;s the system we built from it:</p>
              <div className="thread-count">1 / 6</div>
            </div>
            <footer><strong>Contrarian hook</strong><span>Voice matched · claims checked</span></footer>
          </article>

          <article className="output-card output-linkedin">
            <header><span>POST / LINKEDIN</span><b>1,142 CHARS</b></header>
            <div className="linkedin-sheet">
              <div className="linkedin-author"><span className="platform-avatar">in</span><b>Harmonia Studio</b></div>
              <p>The breakthrough wasn&apos;t more output.</p>
              <p>It was turning one honest customer insight into a system the whole company could learn from.</p>
              <div className="linkedin-graph"><i /><i /><i /><i /><i /></div>
            </div>
            <footer><strong>Operator narrative</strong><span>Policy checked · ready for review</span></footer>
          </article>
        </div>

        <div className="atelier-caption">
          <span>HOVER TO INSPECT</span>
          <p>The object branches, but the source remains traceable through every draft.</p>
        </div>
      </section>

      <section className="approval-section">
        <div className="approval-copy">
          <span className="section-index light">03 — HUMAN CONTROL</span>
          <h2>Autonomous right up to the line that matters.</h2>
          <p>
            Research, editing, and preparation can keep moving asynchronously. Publishing cannot.
            The interface contracts into a focused decision island and waits for a real operator.
          </p>
          <div className="control-notes">
            <span><i>01</i> Exact action preview</span>
            <span><i>02</i> Revision stays in the loop</span>
            <span><i>03</i> Every decision is receipted</span>
          </div>
        </div>
        <ApprovalDemo />
      </section>

      <section id="proof" className="proof-section">
        <div className="proof-heading">
          <span className="section-index">04 — PROOF, NOT VIBES</span>
          <h2>Done means independently verified.</h2>
          <p>
            Harmonia preserves the boring, important parts: permissions, idempotency, retries,
            visible failures, and an audit trail that explains exactly what the agent did.
          </p>
        </div>

        <div className="ledger-window">
          <header>
            <div className="window-lights"><i /><i /><i /></div>
            <span>HARMONIA / RECEIPT LEDGER</span>
            <span className="ledger-ready"><i /> READY</span>
          </header>
          <div className="ledger-body">
            <aside>
              <span className="active">Run timeline</span>
              <span>Assets</span>
              <span>Approvals</span>
              <span>External state</span>
            </aside>
            <div className="ledger-lines">
              <div className="ledger-row complete"><i>✓</i><span><b>Source captured</b><small>Original media fingerprint preserved</small></span><time>INGEST</time></div>
              <div className="ledger-row complete"><i>✓</i><span><b>Draft approved</b><small>Operator decision attached to exact content version</small></span><time>GATE</time></div>
              <div className="ledger-row complete"><i>✓</i><span><b>Publish dispatched once</b><small>Idempotency key prevents duplicate external effects</small></span><time>ACTION</time></div>
              <div className="ledger-row verified"><i>↗</i><span><b>External state verified</b><small>Official platform API read confirms publication</small></span><time>PROOF</time></div>
            </div>
          </div>
          <footer>
            <span>Gemini</span><span>Google ADK</span><span>Cloud Run</span><span>Firestore</span><span>Pub/Sub</span>
          </footer>
        </div>
      </section>

      <section className="loop-section">
        <ReturnGlobe />
        <div className="loop-copy">
          <span className="section-index light">05 — THE RETURN</span>
          <h2>The receipt becomes the next seed.</h2>
          <p>
            Published results flow back into structured memory. The next content cycle begins with
            evidence—not an empty prompt.
          </p>
          <Link href="/dashboard" className="primary-button">Open the content studio <span>↗</span></Link>
        </div>
      </section>

      <footer className="landing-footer">
        <Link href="/" className="footer-brand"><BrandMark className="brand-mark" decorative /> Harmonia</Link>
        <p>From source to signal to proof.</p>
        <div><a href="#workflow">Workflow</a><a href="#outputs">Outputs</a><Link href="/dashboard">Studio ↗</Link></div>
      </footer>
    </main>
  );
}
