"use client";

import { useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import styles from "./HarmoniaWorkspaceElements.module.css";

type Emphasis = "primary" | "secondary" | "compact";

export interface ArtDirectionProps {
  tone: "paper" | "ink" | "acid" | "blue" | "coral" | "violet";
  role: "hero" | "feature" | "support" | "strip" | "inline";
  density: "airy" | "balanced" | "compact";
  motion: "none" | "reveal" | "pulse" | "trace";
}

interface FrameProps extends Partial<ArtDirectionProps> {
  title: string;
  agentFraming?: boolean;
  emphasis?: Emphasis;
  children?: ReactNode;
}

function directed(className: string, props: Partial<ArtDirectionProps>) {
  return {
    className: `${styles.artifact} ${className}`,
    "data-tone": props.tone ?? "paper",
    "data-role": props.role ?? "support",
    "data-density": props.density ?? "balanced",
    "data-motion": props.motion ?? "none",
  } as const;
}

function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

function FrameHeading({ title, agentFraming }: Pick<FrameProps, "title" | "agentFraming">) {
  return (
    <header className={styles.heading}>
      <div>
        {agentFraming && <span className={styles.agentLabel}>Agent framing</span>}
        <h3>{title}</h3>
      </div>
    </header>
  );
}

function Nested({ children }: { children?: ReactNode }) {
  return children ? <div className={styles.nested}>{children}</div> : null;
}

export interface CampaignBriefProps extends FrameProps {
  brief: string;
  sourceKind: "video" | "audio" | "document" | "web" | "text" | "mixed";
  platforms: string[];
  angles: Array<{ id: string; angleType: "source_insight" | "trend" | "meme" | "performance_learning" | "memory_learning"; evidenceKind: "source" | "public_context" | "performance" | "memory"; title: string; rationale: string }>;
}

export function CampaignBrief({ title, brief, sourceKind, platforms, angles, agentFraming, emphasis, children, tone, role, density, motion }: CampaignBriefProps) {
  return (
    <article {...directed(styles.brief, { tone, role, density, motion })} data-emphasis={emphasis ?? "primary"}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <p className={styles.briefCopy}>{brief}</p>
      <dl className={styles.factRow}>
        <div><dt>Source</dt><dd>{sourceKind}</dd></div>
        <div><dt>Destinations</dt><dd>{platforms.join(", ") || "Not selected"}</dd></div>
        <div><dt>Angles</dt><dd>{angles.length}</dd></div>
      </dl>
      {angles.length > 0 && <ul className={styles.angleList}>{angles.map((angle) => <li key={angle.id}><span>{angle.angleType} · {angle.evidenceKind}</span><strong>{angle.title}</strong><p>{angle.rationale}</p></li>)}</ul>}
      <Nested>{children}</Nested>
    </article>
  );
}

export interface JobProgressProps extends FrameProps {
  stage: string;
  status: string;
  stages: Array<{ id: string; label: string; status: "pending" | "active" | "complete" | "failed" }>;
}

export function JobProgress({ title, stage, status, stages, agentFraming, emphasis, children, tone, role, density, motion }: JobProgressProps) {
  return (
    <section {...directed(styles.progress, { tone, role, density, motion })} data-active={stages.some((item) => item.status === "active")} data-emphasis={emphasis ?? "primary"} aria-label={`${title}: ${status}`}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <div className={styles.progressMeta}><strong>{stage.replaceAll("_", " ")}</strong><span>{status.replaceAll("_", " ")}</span></div>
      <ol className={styles.progressTrack}>{stages.map((item) => <li key={item.id} data-status={item.status}><span aria-hidden="true" /><small>{item.label}{item.status === "active" ? " · In progress" : item.status === "failed" ? " · Failed" : ""}</small></li>)}</ol>
      <Nested>{children}</Nested>
    </section>
  );
}

export interface MomentExplorerProps extends FrameProps {
  source?: { id: string; label: string; kind: "video" | "audio" | "media"; previewUrl?: string; externalUrl?: string; durationSec?: number };
  moments: Array<{ id: string; title: string; startSec: number; endSec: number; hook: string; quote: string; visualHook?: string; cropSuitability?: string; selected: boolean }>;
  transcript: Array<{ id: string; startSec: number; endSec: number; text: string }>;
}

export function MomentExplorer({ title, source, moments, transcript, agentFraming, emphasis, children, tone, role, density, motion }: MomentExplorerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeMomentId, setActiveMomentId] = useState(moments.find((moment) => moment.selected)?.id ?? moments[0]?.id);
  const duration = source?.durationSec || Math.max(1, ...moments.map((moment) => moment.endSec));
  function activateMoment(moment: MomentExplorerProps["moments"][number]) {
    setActiveMomentId(moment.id);
    if (videoRef.current) {
      videoRef.current.currentTime = moment.startSec;
      void videoRef.current.play().catch(() => undefined);
    }
  }
  return (
    <figure {...directed(styles.momentExplorer, { tone, role, density, motion })} data-emphasis={emphasis ?? "primary"}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <div className={styles.momentGrid}>
        <div className={styles.sourcePane}>
          {source?.previewUrl && source.kind === "video" && <video ref={videoRef} src={source.previewUrl} controls preload="metadata" aria-label={source.label} />}
          {source?.previewUrl && source.kind === "audio" && <audio src={source.previewUrl} controls aria-label={source.label} />}
          {!source?.previewUrl && <div className={styles.sourcePoster}><span>{source?.kind ?? "source"}</span><strong>{source?.label ?? "Source media"}</strong></div>}
          {source?.externalUrl && <a href={source.externalUrl} target="_blank" rel="noreferrer">Open authenticated source ↗</a>}
          <div className={styles.timeline} aria-label="Selected clip timeline">
            {moments.map((moment) => <span key={moment.id} data-selected={moment.id === activeMomentId} style={{ left: `${Math.min(100, (moment.startSec / duration) * 100)}%`, width: `${Math.max(2, ((moment.endSec - moment.startSec) / duration) * 100)}%` }} title={`${moment.title}, ${clock(moment.startSec)} to ${clock(moment.endSec)}`} />)}
          </div>
        </div>
        <ol className={styles.momentList}>{moments.map((moment) => (
          <li key={moment.id} data-selected={moment.id === activeMomentId}>
            <button type="button" className={styles.momentButton} aria-pressed={moment.id === activeMomentId} aria-label={`Seek to moment ${moment.title} at ${clock(moment.startSec)}`} onClick={() => activateMoment(moment)}>
            <div className={styles.timecode}><time>{clock(moment.startSec)}</time><span>→</span><time>{clock(moment.endSec)}</time></div>
            <h4>{moment.title}</h4>
            <p>{moment.hook}</p>
            <blockquote>{moment.quote}</blockquote>
            {moment.cropSuitability && <small>{moment.cropSuitability} crop</small>}
            </button>
          </li>
        ))}</ol>
      </div>
      {transcript.length > 0 && <details className={styles.transcript} open><summary>Grounded transcript</summary><ol>{transcript.map((segment) => <li key={segment.id}><time>{clock(segment.startSec)}</time><p>{segment.text}</p></li>)}</ol></details>}
      <Nested>{children}</Nested>
    </figure>
  );
}

export interface HydratedDraftView {
  id: string;
  platform: string;
  text: string;
  valid: boolean;
  validationNote?: string;
  momentId?: string;
  angleId?: string;
  selected: boolean;
  sourceCount: number;
}

export interface DraftComparisonProps extends FrameProps { drafts: HydratedDraftView[]; onRequestRevision?: (draftId: string) => void }

export function DraftComparison({ title, drafts, agentFraming, emphasis, children, onRequestRevision, tone, role, density, motion }: DraftComparisonProps) {
  const [activeDraftId, setActiveDraftId] = useState(drafts.find((draft) => draft.selected)?.id ?? drafts[0]?.id);
  return (
    <section {...directed(styles.draftComparison, { tone, role, density, motion })} data-emphasis={emphasis ?? "primary"}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <div className={styles.draftTabs} role="tablist" aria-label="Draft comparison">{drafts.map((draft) => <button key={draft.id} type="button" role="tab" aria-selected={draft.id === activeDraftId} onClick={() => setActiveDraftId(draft.id)}>{draft.platform} · {draft.id}</button>)}</div>
      <div className={styles.draftGrid}>{drafts.map((draft) => (
        <article key={draft.id} data-selected={draft.id === activeDraftId}>
          <header><button type="button" aria-label={`Compare draft ${draft.id}`} onClick={() => setActiveDraftId(draft.id)}>{draft.platform}</button><strong>{draft.valid ? "Ready" : "Needs revision"}</strong></header>
          <p className={styles.draftText}>{draft.text}</p>
          <footer><span>{draft.sourceCount} {draft.sourceCount === 1 ? "source" : "sources"}</span><code>{draft.id}</code></footer>
          {draft.validationNote && <p className={styles.validation}>{draft.validationNote}</p>}
          <button type="button" className={styles.revisionButton} aria-label={`Request revision for draft ${draft.id}`} disabled={!onRequestRevision} onClick={() => onRequestRevision?.(draft.id)}>Recompose this view</button>
        </article>
      ))}</div>
      <Nested>{children}</Nested>
    </section>
  );
}

export interface PlatformPreviewProps extends FrameProps {
  draft: HydratedDraftView;
  assets: Array<{ actionId: string; mime: string; previewUrl: string }>;
}

export function PlatformPreview({ title, draft, assets, agentFraming, emphasis, children, tone, role, density, motion }: PlatformPreviewProps) {
  return (
    <article {...directed(styles.platformPreview, { tone, role, density, motion })} data-emphasis={emphasis ?? "primary"}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <div className={styles.socialCard}>
        <header><BrandMark className={styles.avatar} decorative /><div><strong>Harmonia campaign</strong><small>@startup · draft</small></div><span>•••</span></header>
        <p>{draft.text}</p>
        {assets.map((asset) => asset.mime.startsWith("image/")
          // Dynamic, authenticated job assets cannot use Next's unauthenticated image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={asset.actionId} src={asset.previewUrl} alt={`Generated asset ${asset.actionId}`} />
          : asset.mime.startsWith("video/")
            ? <video key={asset.actionId} src={asset.previewUrl} controls preload="metadata" aria-label={`Generated asset ${asset.actionId}`} />
            : asset.mime.startsWith("audio/")
              ? <audio key={asset.actionId} src={asset.previewUrl} controls aria-label={`Generated asset ${asset.actionId}`} />
              : null)}
        <footer><span>Reply</span><span>Repost</span><span>Like</span><span>Share</span></footer>
      </div>
      <Nested>{children}</Nested>
    </article>
  );
}

export interface SourceEvidenceProps extends FrameProps {
  sources: Array<{ id: string; kind: string; label: string; url?: string; excerpt?: string }>;
  links: Array<{ fromId: string; toId: string; label: string }>;
}

export function SourceEvidence({ title, sources, links, agentFraming, emphasis, children, tone, role, density, motion }: SourceEvidenceProps) {
  return (
    <section {...directed(styles.evidence, { tone, role, density, motion })} data-emphasis={emphasis ?? "primary"}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <ol>{sources.map((source) => <li key={source.id}><span>{source.kind}</span><div><strong>{source.label}</strong>{source.excerpt && <blockquote>{source.excerpt}</blockquote>}{source.url && <a href={source.url} target="_blank" rel="noreferrer">Open source ↗</a>}</div><code>{source.id}</code></li>)}</ol>
      {links.length > 0 && <details><summary>{links.length} provenance {links.length === 1 ? "link" : "links"}</summary><ul>{links.map((link, index) => <li key={`${link.fromId}-${link.toId}-${index}`}><code>{link.fromId}</code><span>{link.label}</span><code>{link.toId}</code></li>)}</ul></details>}
      <Nested>{children}</Nested>
    </section>
  );
}

export interface ApprovalReviewProps extends FrameProps {
  actionId: string;
  actionType: string;
  description: string;
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  approvalState: "not_required" | "pending" | "approved" | "rejected";
  actionState: "planned" | "executed" | "skipped" | "failed";
  destination?: string;
  previewText?: string;
}

export function ApprovalReview({ title, actionId, actionType, description, risk, requiresApproval, approvalState, actionState, destination, previewText, agentFraming, emphasis, children, tone, role, density, motion }: ApprovalReviewProps) {
  return (
    <aside {...directed(styles.approval, { tone, role, density, motion })} data-risk={risk} data-emphasis={emphasis ?? "primary"}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <div className={styles.approvalMeta}><span>{risk} risk</span><span>{approvalState.replaceAll("_", " ")}</span><code>{actionId}</code></div>
      <p>{description}</p>
      {previewText && <blockquote>{previewText}</blockquote>}
      <dl><div><dt>Action</dt><dd>{actionType.replaceAll("_", " ")}</dd></div>{destination && <div><dt>Destination</dt><dd>{destination}</dd></div>}<div><dt>Execution</dt><dd>{actionState}</dd></div></dl>
      {requiresApproval && approvalState === "pending" && <p className={styles.guardrail}>Publishing remains blocked until the operator uses Harmonia’s protected approval controls.</p>}
      <Nested>{children}</Nested>
    </aside>
  );
}

export interface VerificationReceiptProps extends FrameProps {
  receiptId: string;
  actionId: string;
  actionType: string;
  performedAt: string;
  outcome: "applied" | "already_applied" | "rejected" | "failed";
  verified: boolean;
  verificationMethod?: string;
  verificationNote?: string;
  artifact?: { kind: string; url?: string; digest?: string | null };
}

export function VerificationReceipt({ title, receiptId, actionId, actionType, performedAt, outcome, verified, verificationMethod, verificationNote, artifact, agentFraming, emphasis, children, tone, role, density, motion }: VerificationReceiptProps) {
  return (
    <article {...directed(styles.receipt, { tone, role, density, motion })} data-verified={verified} data-emphasis={emphasis ?? "primary"}>
      <FrameHeading title={title} agentFraming={agentFraming} />
      <div className={styles.receiptSeal}><span aria-hidden="true">{verified ? "✓" : "!"}</span><div><strong>{verified ? "Verified" : "Verification pending"}</strong><small>{outcome.replaceAll("_", " ")}</small></div></div>
      <dl><div><dt>Receipt</dt><dd><code>{receiptId}</code></dd></div><div><dt>Action</dt><dd><code>{actionId}</code> · {actionType.replaceAll("_", " ")}</dd></div><div><dt>Performed</dt><dd><time dateTime={performedAt}>{new Date(performedAt).toLocaleString("en", { timeZone: "UTC" })} UTC</time></dd></div>{verificationMethod && <div><dt>Method</dt><dd>{verificationMethod}</dd></div>}</dl>
      {verificationNote && <p>{verificationNote}</p>}
      {artifact?.url && <a href={artifact.url} target="_blank" rel="noreferrer">Inspect evidence ↗</a>}
      {artifact?.digest && <code className={styles.digest}>{artifact.kind} · {artifact.digest}</code>}
      <Nested>{children}</Nested>
    </article>
  );
}

export interface SurfaceStateProps extends FrameProps { message: string }
export function SurfaceLoading(props: SurfaceStateProps) { return <section {...directed(styles.state, props)} aria-live="polite"><FrameHeading title={props.title} agentFraming={props.agentFraming} /><p>{props.message}</p><span className={styles.loadingBar} /><Nested>{props.children}</Nested></section>; }
export function SurfaceEmpty(props: SurfaceStateProps) { return <section {...directed(styles.state, props)}><FrameHeading title={props.title} agentFraming={props.agentFraming} /><p>{props.message}</p><Nested>{props.children}</Nested></section>; }
export function SurfaceUnresolved(props: SurfaceStateProps & { missingRefs: string[] }) { return <section {...directed(styles.state, props)} data-state="unresolved"><FrameHeading title={props.title} agentFraming={props.agentFraming} /><p>{props.message}</p><code>{props.missingRefs.join(", ")}</code><Nested>{props.children}</Nested></section>; }
export function SurfaceFailure(props: SurfaceStateProps & { retryable: boolean }) { return <section {...directed(styles.state, props)} data-state="failed" role="alert"><FrameHeading title={props.title} agentFraming={props.agentFraming} /><p>{props.message}</p>{props.retryable && <small>Retry is available from the conversation.</small>}<Nested>{props.children}</Nested></section>; }
