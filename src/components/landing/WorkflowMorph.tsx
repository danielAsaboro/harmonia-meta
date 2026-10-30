"use client";

import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { WORKFLOW_STAGES } from "./workflow";

const WAVES = [34, 58, 42, 82, 66, 28, 74, 92, 48, 64, 36, 78, 54, 88, 44, 68, 30, 62, 76, 40, 86, 56, 72, 46];

function MatterContents() {
  return (
    <>
      <div className="matter-source">
        <span className="matter-play">▶</span>
        <span className="matter-timestamp">16:42</span>
        <div className="matter-caption">How we found our first 100 users</div>
      </div>

      <div className="matter-wave" aria-hidden="true">
        {WAVES.map((height, index) => (
          <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </div>

      <div className="matter-transcript">
        <span>00:41</span>
        <p>
          The turning point wasn&apos;t more reach. It was finally understanding the conversation
          customers were already having.
        </p>
        <mark>turning point</mark>
      </div>

      <div className="matter-ideas">
        <span className="idea-chip idea-a">Founder lesson</span>
        <span className="idea-chip idea-b">Contrarian hook</span>
        <span className="idea-chip idea-c">42s clip</span>
        <span className="idea-core">7</span>
      </div>

      <div className="matter-drafts">
        <article><span>𝕏</span><strong>Thread</strong><i /></article>
        <article><span>in</span><strong>Post</strong><i /></article>
        <article><span>▶</span><strong>Short</strong><i /></article>
      </div>

      <div className="matter-approval">
        <div><span>HUMAN CHECKPOINT</span><strong>3 outputs ready</strong></div>
        <button type="button">Revise</button>
        <button type="button">Approve all ✓</button>
      </div>

      <div className="matter-publish">
        <span className="publish-orbit orbit-a">𝕏</span>
        <span className="publish-orbit orbit-b">in</span>
        <span className="publish-orbit orbit-c">▶</span>
        <span className="publish-core">↗</span>
      </div>

      <div className="matter-receipt">
        <span className="receipt-check">✓</span>
        <div><small>INDEPENDENTLY VERIFIED</small><strong>External state confirmed</strong></div>
        <span className="receipt-time">19:08:14</span>
      </div>

      <div className="matter-learn">
        <BrandMark className="learn-seed" decorative />
        <i /><i /><i />
        <small>MEMORY UPDATED</small>
      </div>
    </>
  );
}

export function WorkflowMorph() {
  const [activeIndex, setActiveIndex] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const activeStage = WORKFLOW_STAGES[activeIndex];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const nextIndex = Number((visible.target as HTMLElement).dataset.index);
        if (Number.isFinite(nextIndex)) setActiveIndex(nextIndex);
      },
      { rootMargin: "-28% 0px -40%", threshold: [0.1, 0.35, 0.65] },
    );

    stepRefs.current.forEach((step) => step && observer.observe(step));
    return () => observer.disconnect();
  }, []);

  const chooseStage = (index: number) => {
    setActiveIndex(index);
    stepRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section id="workflow" className="workflow-section">
      <div className="section-intro">
        <span className="section-index">01 — THE ENGINE</span>
        <h2>Follow one idea as it changes state.</h2>
        <p>
          Not a diagram of boxes. One continuous piece of signal matter—reshaped by every stage,
          paused by you, and never allowed to disappear into a black box.
        </p>
      </div>

      <div className="workflow-layout">
        <div className="workflow-stage-wrap">
          <div className="workflow-stage">
            <div className="workflow-island">
              <span className="island-dot" />
              <strong>{activeStage.verb}</strong>
              <span>{activeStage.signal}</span>
              <b>{activeStage.index} / 08</b>
            </div>

            <div className="morph-field">
              <div className="field-grid" aria-hidden="true" />
              <span className="field-label label-top">LIVE WORKFLOW / SCROLL CONTROLLED</span>
              <span className="field-label label-bottom">ONE OBJECT · EIGHT STATES · FULL RECEIPT CHAIN</span>
              <div className="signal-trace" aria-hidden="true"><i /></div>
              <div className="signal-matter" data-stage={activeStage.id}>
                <MatterContents />
              </div>
              <div className="stage-readout">
                <span>{activeStage.index}</span>
                <div>
                  <small>{activeStage.verb}</small>
                  <strong>{activeStage.title}</strong>
                </div>
              </div>
            </div>

            <div className="stage-dots" aria-label="Choose workflow stage">
              {WORKFLOW_STAGES.map((stage, index) => (
                <button
                  key={stage.id}
                  type="button"
                  className={index === activeIndex ? "active" : ""}
                  onClick={() => chooseStage(index)}
                  aria-label={`Show ${stage.verb} stage`}
                  aria-pressed={index === activeIndex}
                >
                  <i /><span>{stage.verb}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="workflow-copy-rail">
          {WORKFLOW_STAGES.map((stage, index) => (
            <article
              key={stage.id}
              ref={(node) => { stepRefs.current[index] = node; }}
              data-index={index}
              className={index === activeIndex ? "active" : ""}
              onClick={() => chooseStage(index)}
            >
              <span>{stage.index}</span>
              <div>
                <small>{stage.verb}</small>
                <h3>{stage.title}</h3>
                <p>{stage.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
