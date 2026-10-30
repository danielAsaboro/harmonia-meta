"use client";

import { useEffect, useRef, useState } from "react";

import { LIVE_WORKFLOW_FRAMES } from "./workflow";

const MODES = [
  { id: "source", label: "Source", note: "Original asset" },
  { id: "intelligence", label: "Intelligence", note: "Gemini analysis" },
  { id: "drafts", label: "Drafts", note: "Platform-native" },
  { id: "delivery", label: "Delivery", note: "Action + proof" },
] as const;

export function LiveWorkflow() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const activeFrame = LIVE_WORKFLOW_FRAMES[activeIndex];

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.28 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % LIVE_WORKFLOW_FRAMES.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, [isVisible]);

  return (
    <section ref={sectionRef} className="live-workflow-section" data-layer="live-workflow">
      <div className="live-workflow-intro">
        <span className="section-index">INTERLUDE — INSIDE THE RUN</span>
        <h2 id="live-workflow-title">Watch the work move.</h2>
        <p>
          The board is not decoration. It exposes the handoffs, pauses, and receipts that turn one
          source into a controlled external action.
        </p>
      </div>

      <div className="workbench-window" data-frame={activeFrame.id}>
        <header className="workbench-bar">
          <div className="window-lights" aria-hidden="true"><i /><i /><i /></div>
          <span>HARMONIA / LIVE CONTENT RUN</span>
          <span className="workbench-running"><i /> {activeFrame.label}</span>
        </header>

        <div className="workbench-body">
          <aside className="workbench-sidebar" aria-label="Workflow views">
            <small>RUN SURFACES</small>
            {MODES.map((mode) => (
              <div key={mode.id} className={activeFrame.mode === mode.id ? "active" : ""}>
                <i />
                <span><strong>{mode.label}</strong><small>{mode.note}</small></span>
              </div>
            ))}
            <footer><span>{activeIndex + 1} / {LIVE_WORKFLOW_FRAMES.length} ACTIVE</span><i /></footer>
          </aside>

          <div className="workbench-canvas">
            <div className="workbench-grid" aria-hidden="true" />

            <div className="workbench-path" aria-label="Live run stages">
              {LIVE_WORKFLOW_FRAMES.map((frame, index) => (
                <button
                  key={frame.id}
                  type="button"
                  className={index === activeIndex ? "active" : index < activeIndex ? "complete" : ""}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Show ${frame.label}`}
                  aria-pressed={index === activeIndex}
                >
                  <i />
                  <span>{frame.step}</span>
                </button>
              ))}
            </div>

            <div className="workbench-scene">
              <article className="run-panel run-source">
                <small>SOURCE ASSET</small>
                <div className="run-video"><i>▶</i><span>16:42</span></div>
                <strong>Founder story</strong>
                <p>Original fingerprint preserved</p>
              </article>

              <article className="run-panel run-transcript">
                <small>TIMED TRANSCRIPT</small>
                <div className="run-wave" aria-hidden="true">
                  {Array.from({ length: 20 }, (_, index) => <i key={index} />)}
                </div>
                <p><span>00:41</span> The turning point wasn&apos;t more reach. It was hearing the signal.</p>
              </article>

              <div className="run-signals">
                <article><small>CLAIM</small><strong>Customer signal</strong><span>92% relevance</span></article>
                <article><small>HOOK</small><strong>Contrarian opener</strong><span>High confidence</span></article>
                <article><small>CLIP</small><strong>00:38—01:20</strong><span>42 seconds</span></article>
                <b>7</b>
              </div>

              <div className="run-drafts">
                <article><span>𝕏</span><small>THREAD</small><strong>6 connected posts</strong><i /></article>
                <article><span>in</span><small>LINKEDIN</small><strong>Operator narrative</strong><i /></article>
                <article><span>▶</span><small>SHORT</small><strong>9:16 · 00:42</strong><i /></article>
              </div>

              <article className="run-panel run-approval">
                <div><small>HUMAN CHECKPOINT</small><strong>3 actions are ready</strong></div>
                <button type="button" onClick={() => setActiveIndex(5)}>Approve &amp; continue <span>✓</span></button>
              </article>

              <div className="run-publish">
                <i className="publish-beam" />
                <span>𝕏</span><span>in</span><span>▶</span>
                <strong>1×</strong>
                <small>IDEMPOTENT DISPATCH</small>
              </div>

              <article className="run-panel run-verified">
                <span>✓</span>
                <div><small>EXTERNAL STATE</small><strong>Independently verified</strong><p>Receipt attached · memory updated</p></div>
                <time>PROOF</time>
              </article>

              <div className="workflow-pointer" aria-hidden="true">
                <span>Harmonia</span>
                <i />
              </div>
            </div>

            <footer className="workbench-command">
              <span>›</span>
              <p><strong>{activeFrame.label}</strong> — {activeFrame.detail}</p>
              <button type="button" onClick={() => setActiveIndex(0)}>Replay</button>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}
