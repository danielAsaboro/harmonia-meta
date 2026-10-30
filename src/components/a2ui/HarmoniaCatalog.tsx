/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- A2UI's v0.9 generic binder types currently exhaust TypeScript's
// heap when expanded across a custom catalog. Runtime Zod schemas remain strict.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod/v3";
import {
  A2uiMessageSchema,
  Catalog,
  type ComponentApi,
  MessageProcessor,
  type A2uiClientAction,
  type SurfaceModel,
} from "@a2ui/web_core/v0_9";
import {
  A2uiSurface,
  basicCatalog,
  createComponentImplementation,
  type ReactComponentImplementation,
} from "@a2ui/react/v0_9";
import { HARMONIA_CATALOG_ID } from "@/lib/a2ui/contracts";
import {
  ActivityTrace,
  AttachmentCard,
  ConfirmationCard,
  ContextUsage,
  InlineCitation,
  MessageContent,
  PlanView,
  QueueView,
  ReasoningSummary,
  TaskView,
  ToolActivity,
  type ActivityStep,
  type AttachmentView,
  type ElementStatus,
} from "./HarmoniaElements";
import {
  ApprovalReview,
  CampaignBrief,
  DraftComparison,
  JobProgress,
  MomentExplorer,
  PlatformPreview,
  SourceEvidence,
  SurfaceEmpty,
  SurfaceFailure,
  SurfaceLoading,
  SurfaceUnresolved,
  VerificationReceipt,
} from "./HarmoniaWorkspaceElements";
import styles from "./HarmoniaWorkspaceElements.module.css";

const status = z.enum(["pending", "active", "complete", "failed"]);
const step = z.object({ id: z.string(), label: z.string(), description: z.string().optional(), status });

const ActivityTraceApi: ComponentApi = { name: "ActivityTrace", schema: z.object({ title: z.string(), steps: z.array(step) }) };
const ReasoningSummaryApi: ComponentApi = { name: "ReasoningSummary", schema: z.object({ summary: z.string() }) };
const AttachmentCardApi: ComponentApi = { name: "AttachmentCard", schema: z.object({ attachmentId: z.string().min(1), filename: z.string(), mime: z.string(), sizeBytes: z.number(), state: z.enum(["uploading", "ready", "failed"]), previewUrl: z.string().refine((value) => value.startsWith("/api/chat/attachments/") || /^\/api\/jobs\/[^/]+\/assets\/[^/]+$/.test(value)).optional() }) };
const InlineCitationApi: ComponentApi = { name: "InlineCitation", schema: z.object({ title: z.string(), url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)), sourceId: z.string().optional(), excerpt: z.string().optional() }) };
const PlanViewApi: ComponentApi = { name: "PlanView", schema: z.object({ title: z.string(), steps: z.array(step) }) };
const QueueViewApi: ComponentApi = { name: "QueueView", schema: z.object({ title: z.string(), items: z.array(step.extend({ jobId: z.string().optional() })) }) };
const ToolActivityApi: ComponentApi = { name: "ToolActivity", schema: z.object({ name: z.string(), status, inputSummary: z.string().optional(), outputSummary: z.string().optional(), durationMs: z.number().optional(), traceId: z.string().optional() }) };
const TaskViewApi: ComponentApi = { name: "TaskView", schema: z.object({ title: z.string(), owner: z.string().optional(), status, jobId: z.string().optional(), stage: z.string().optional() }) };
const ContextUsageApi: ComponentApi = { name: "ContextUsage", schema: z.object({ model: z.string(), inputTokens: z.number(), outputTokens: z.number(), contextLimit: z.number().optional(), cachedTokens: z.number().optional(), estimatedCostUsd: z.number().optional() }) };
const MessageContentApi: ComponentApi = { name: "MessageContent", schema: z.object({ text: z.string() }) };
const ConfirmationApi: ComponentApi = { name: "Confirmation", schema: z.object({ operationId: z.string().min(1).optional(), jobId: z.string().min(1).optional(), actionId: z.string().min(1).optional(), title: z.string(), description: z.string().optional(), risk: z.enum(["low", "material", "high"]), state: z.enum(["pending", "approved", "rejected", "expired"]) }).refine((value) => Boolean(value.operationId) !== Boolean(value.jobId && value.actionId)) };

const generatedNode = {
  children: z.array(z.string().min(1)).max(30).default([]),
  emphasis: z.enum(["primary", "secondary", "compact"]).default("primary"),
  agentFraming: z.boolean().default(false),
  tone: z.enum(["paper", "ink", "acid", "blue", "coral", "violet"]).default("paper"),
  role: z.enum(["hero", "feature", "support", "strip", "inline"]).default("support"),
  density: z.enum(["airy", "balanced", "compact"]).default("balanced"),
  motion: z.enum(["none", "reveal", "pulse", "trace"]).default("none"),
  surfaceRhythm: z.enum(["editorial", "operational", "cinematic", "evidence"]).default("editorial"),
  surfaceComposition: z.enum(["stack", "split", "mosaic", "rail"]).default("stack"),
  surfaceEnergy: z.enum(["quiet", "active", "resolved"]).default("quiet"),
  revision: z.number().int().positive().default(1),
};
const hydratedDraft = z.object({ id: z.string().min(1), platform: z.string().min(1), text: z.string(), valid: z.boolean(), validationNote: z.string().optional(), momentId: z.string().min(1).optional(), angleId: z.string().min(1).optional(), selected: z.boolean(), sourceCount: z.number().int().nonnegative() }).strict();
const CampaignBriefApi: ComponentApi = { name: "CampaignBrief", schema: z.object({ jobId: z.string().min(1), title: z.string().min(1), brief: z.string(), sourceKind: z.enum(["video", "audio", "document", "web", "text", "mixed"]), platforms: z.array(z.string()).max(10), angles: z.array(z.object({ id: z.string().min(1), angleType: z.enum(["source_insight", "trend", "meme", "performance_learning", "memory_learning"]), evidenceKind: z.enum(["source", "public_context", "performance", "memory"]), title: z.string(), rationale: z.string() }).strict()).max(20), ...generatedNode }).strict() };
const JobProgressApi: ComponentApi = { name: "JobProgress", schema: z.object({ jobId: z.string().min(1), title: z.string().min(1), stage: z.string().min(1), status: z.string().min(1), stages: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), status }).strict()).max(20), ...generatedNode }).strict() };
const MomentExplorerApi: ComponentApi = { name: "MomentExplorer", schema: z.object({ jobId: z.string().min(1), title: z.string().min(1), source: z.object({ id: z.string().min(1), label: z.string().min(1), kind: z.enum(["video", "audio", "media"]), previewUrl: z.string().refine((value) => value.startsWith("/api/chat/attachments/")).optional(), externalUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).optional(), durationSec: z.number().nonnegative().optional() }).strict().optional(), moments: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), startSec: z.number().nonnegative(), endSec: z.number().nonnegative(), hook: z.string(), quote: z.string(), visualHook: z.string().optional(), cropSuitability: z.enum(["poor", "fair", "good", "excellent"]).optional(), selected: z.boolean() }).strict()).max(20), transcript: z.array(z.object({ id: z.string().min(1), startSec: z.number().nonnegative(), endSec: z.number().nonnegative(), text: z.string() }).strict()).max(200), ...generatedNode }).strict() };
const DraftComparisonApi: ComponentApi = { name: "DraftComparison", schema: z.object({ jobId: z.string().min(1), title: z.string().min(1), drafts: z.array(hydratedDraft).min(1).max(20), ...generatedNode }).strict() };
const PlatformPreviewApi: ComponentApi = { name: "PlatformPreview", schema: z.object({ jobId: z.string().min(1), title: z.string().min(1), draft: hydratedDraft, assets: z.array(z.object({ actionId: z.string().min(1), mime: z.string().min(1), previewUrl: z.string().refine((value) => /^\/api\/jobs\/[^/]+\/assets\/[^/]+$/.test(value)) }).strict()).max(20), ...generatedNode }).strict() };
const SourceEvidenceApi: ComponentApi = { name: "SourceEvidence", schema: z.object({ jobId: z.string().min(1), title: z.string().min(1), sources: z.array(z.object({ id: z.string().min(1), kind: z.enum(["video", "audio", "document", "web", "text", "segment", "moment", "angle", "receipt"]), label: z.string().min(1), url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).optional(), excerpt: z.string().optional() }).strict()).min(1).max(100), links: z.array(z.object({ fromId: z.string().min(1), toId: z.string().min(1), label: z.string().min(1) }).strict()).max(200), ...generatedNode }).strict() };
const ApprovalReviewApi: ComponentApi = { name: "ApprovalReview", schema: z.object({ jobId: z.string().min(1), actionId: z.string().min(1), actionType: z.string().min(1), title: z.string().min(1), description: z.string(), risk: z.enum(["low", "medium", "high"]), requiresApproval: z.boolean(), approvalState: z.enum(["not_required", "pending", "approved", "rejected"]), actionState: z.enum(["planned", "executed", "skipped", "failed"]), destination: z.string().optional(), previewText: z.string().optional(), ...generatedNode }).strict() };
const VerificationReceiptApi: ComponentApi = { name: "VerificationReceipt", schema: z.object({ jobId: z.string().min(1), receiptId: z.string().min(1), actionId: z.string().min(1), actionType: z.string().min(1), title: z.string().min(1), performedAt: z.string().datetime(), outcome: z.enum(["applied", "already_applied", "rejected", "failed"]), verified: z.boolean(), verificationMethod: z.string().optional(), verificationNote: z.string().optional(), artifact: z.object({ kind: z.string().min(1), url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).optional(), digest: z.string().nullable().optional() }).strict().optional(), ...generatedNode }).strict() };
const stateNode = { title: z.string().min(1), message: z.string(), ...generatedNode };
const SurfaceLoadingApi: ComponentApi = { name: "SurfaceLoading", schema: z.object(stateNode).strict() };
const SurfaceEmptyApi: ComponentApi = { name: "SurfaceEmpty", schema: z.object(stateNode).strict() };
const SurfaceUnresolvedApi: ComponentApi = { name: "SurfaceUnresolved", schema: z.object({ ...stateNode, missingRefs: z.array(z.string().min(1)).min(1).max(100) }).strict() };
const SurfaceFailureApi: ComponentApi = { name: "SurfaceFailure", schema: z.object({ ...stateNode, retryable: z.boolean() }).strict() };

const builtChildren = (children: string[] | undefined, buildChild: (id: string) => React.ReactNode) => children?.map((id) => <span key={id}>{buildChild(id)}</span>);

const customImplementations: ReactComponentImplementation[] = [
  createComponentImplementation(ActivityTraceApi, ({ props }) => <ActivityTrace title={props.title} steps={props.steps as ActivityStep[]} />),
  createComponentImplementation(ReasoningSummaryApi, ({ props }) => <ReasoningSummary summary={props.summary} />),
  createComponentImplementation(AttachmentCardApi, ({ props }) => <AttachmentCard attachment={props as AttachmentView} />),
  createComponentImplementation(InlineCitationApi, ({ props }) => <InlineCitation {...props} />),
  createComponentImplementation(PlanViewApi, ({ props }) => <PlanView title={props.title} steps={props.steps as ActivityStep[]} />),
  createComponentImplementation(QueueViewApi, ({ props }) => <QueueView title={props.title} items={props.items as Array<ActivityStep & { jobId?: string }>} />),
  createComponentImplementation(ToolActivityApi, ({ props }) => <ToolActivity {...props} status={props.status as ElementStatus} />),
  createComponentImplementation(TaskViewApi, ({ props }) => <TaskView {...props} status={props.status as ElementStatus} />),
  createComponentImplementation(ContextUsageApi, ({ props }) => <ContextUsage {...props} />),
  createComponentImplementation(MessageContentApi, ({ props }) => <MessageContent text={props.text} />),
  createComponentImplementation(ConfirmationApi, ({ props, context }) => (
    <ConfirmationCard
      {...props}
      onDecision={(decision) => void context.surface.dispatchAction(props.jobId && props.actionId ? {
        name: "decide_job_action",
        context: { jobId: props.jobId, actionId: props.actionId, decision },
      } : {
        name: "decide_operation",
        context: { operationId: props.operationId, decision },
      }, context.component.id)}
    />
  )),
  createComponentImplementation(CampaignBriefApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <CampaignBrief {...rest}>{builtChildren(children, buildChild)}</CampaignBrief>; }),
  createComponentImplementation(JobProgressApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <JobProgress {...rest}>{builtChildren(children, buildChild)}</JobProgress>; }),
  createComponentImplementation(MomentExplorerApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <MomentExplorer {...rest}>{builtChildren(children, buildChild)}</MomentExplorer>; }),
  createComponentImplementation(DraftComparisonApi, ({ props, buildChild, context }) => { const { children, ...rest } = props; return <DraftComparison {...rest} onRequestRevision={(draftId) => context.surface.dispatchAction({ name: "request_surface_revision", context: { jobId: props.jobId, draftId } }, context.component.id)}>{builtChildren(children, buildChild)}</DraftComparison>; }),
  createComponentImplementation(PlatformPreviewApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <PlatformPreview {...rest}>{builtChildren(children, buildChild)}</PlatformPreview>; }),
  createComponentImplementation(SourceEvidenceApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <SourceEvidence {...rest}>{builtChildren(children, buildChild)}</SourceEvidence>; }),
  createComponentImplementation(ApprovalReviewApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <ApprovalReview {...rest}>{builtChildren(children, buildChild)}</ApprovalReview>; }),
  createComponentImplementation(VerificationReceiptApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <VerificationReceipt {...rest}>{builtChildren(children, buildChild)}</VerificationReceipt>; }),
  createComponentImplementation(SurfaceLoadingApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <SurfaceLoading {...rest}>{builtChildren(children, buildChild)}</SurfaceLoading>; }),
  createComponentImplementation(SurfaceEmptyApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <SurfaceEmpty {...rest}>{builtChildren(children, buildChild)}</SurfaceEmpty>; }),
  createComponentImplementation(SurfaceUnresolvedApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <SurfaceUnresolved {...rest}>{builtChildren(children, buildChild)}</SurfaceUnresolved>; }),
  createComponentImplementation(SurfaceFailureApi, ({ props, buildChild }) => { const { children, ...rest } = props; return <SurfaceFailure {...rest}>{builtChildren(children, buildChild)}</SurfaceFailure>; }),
];

export const harmoniaCatalog = new Catalog<ReactComponentImplementation>(
  HARMONIA_CATALOG_ID,
  [...basicCatalog.components.values(), ...customImplementations],
  [...basicCatalog.functions.values()],
);

export function parseHarmoniaA2uiOperation(operation: unknown) {
  const parsed = A2uiMessageSchema.parse(operation);
  if ("updateComponents" in parsed) {
    for (const component of parsed.updateComponents.components) {
      const implementation = harmoniaCatalog.components.get(component.component);
      if (!implementation) throw new Error(`A2UI component is not registered: ${component.component}`);
      const properties = { ...component };
      delete properties.id;
      delete properties.component;
      implementation.schema.parse(properties);
    }
  }
  return parsed;
}

export interface SurfaceFrameMetadata {
  composition: "stack" | "split" | "mosaic" | "rail";
  rhythm: "editorial" | "operational" | "cinematic" | "evidence";
  energy: "quiet" | "active" | "resolved";
  revision: number;
}

const DEFAULT_SURFACE_FRAME: SurfaceFrameMetadata = {
  composition: "stack",
  rhythm: "editorial",
  energy: "quiet",
  revision: 1,
};

export function surfaceFrameMetadata(surface: SurfaceModel<ReactComponentImplementation> | undefined): SurfaceFrameMetadata {
  if (!surface) return DEFAULT_SURFACE_FRAME;
  const queue = ["root"];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const componentId = queue.shift();
    if (!componentId || visited.has(componentId)) continue;
    visited.add(componentId);
    const component = surface.componentsModel.get(componentId);
    if (!component) continue;
    const properties = component.properties as Partial<Record<string, unknown>>;
    if (typeof properties.surfaceComposition === "string") {
      return {
        composition: properties.surfaceComposition as SurfaceFrameMetadata["composition"],
        rhythm: properties.surfaceRhythm as SurfaceFrameMetadata["rhythm"],
        energy: properties.surfaceEnergy as SurfaceFrameMetadata["energy"],
        revision: properties.revision as number,
      };
    }
    if (Array.isArray(properties.children)) {
      queue.push(...properties.children.filter((child): child is string => typeof child === "string"));
    }
  }
  return DEFAULT_SURFACE_FRAME;
}

export function surfaceMotionState({
  live,
  operationsGrew,
  previousRevision,
  revision,
}: {
  live: boolean;
  operationsGrew: boolean;
  previousRevision?: number;
  revision: number;
}) {
  return {
    liveUpdate: live && operationsGrew,
    revisionChanged: live && previousRevision !== undefined && revision > previousRevision,
  };
}

export function HarmoniaA2uiHost({ operations, onAction, onProtocolError, className, live = false }: { operations: unknown[]; onAction?: (action: A2uiClientAction) => void | Promise<void>; onProtocolError?: (error: Error) => void; className?: string; live?: boolean }) {
  const processor = useMemo(() => new MessageProcessor<ReactComponentImplementation>(
    [harmoniaCatalog],
    (action) => onAction?.(action),
  ), [onAction]);
  const processed = useRef(0);
  const [surfaces, setSurfaces] = useState<Array<SurfaceModel<ReactComponentImplementation>>>([]);
  const [protocolError, setProtocolError] = useState<string | null>(null);

  useEffect(() => {
    processed.current = 0;
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    sync();
    return () => { created.unsubscribe(); deleted.unsubscribe(); processor.model.dispose(); };
  }, [processor]);

  useEffect(() => {
    try {
      if (operations.length < processed.current) processed.current = 0;
      const next = operations.slice(processed.current).map(parseHarmoniaA2uiOperation);
      if (next.length) processor.processMessages(next);
      processed.current = operations.length;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      // The error is emitted by the external A2UI processor synchronized in
      // this effect; surfacing it is the fail-closed UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProtocolError(failure.message);
      onProtocolError?.(failure);
    }
  }, [live, onProtocolError, operations, processor]);

  return <div className={className ?? "flex flex-col gap-2"}>{protocolError && <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">A2UI protocol error: {protocolError}</p>}{surfaces.map((surface) => {
    const frame = surfaceFrameMetadata(surface);
    const motion = surfaceMotionState({
      live,
      operationsGrew: live,
      previousRevision: frame.revision > 1 ? frame.revision - 1 : undefined,
      revision: frame.revision,
    });
    return <div
      key={surface.id}
      className={styles.surfaceFrame}
      data-composition={frame.composition}
      data-rhythm={frame.rhythm}
      data-energy={frame.energy}
      data-revision={frame.revision}
      data-live-update={motion.liveUpdate}
      data-revision-changed={motion.revisionChanged}
    ><A2uiSurface surface={surface} /></div>;
  })}</div>;
}
