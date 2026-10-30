"use client";

import { useEffect } from "react";
import type { ArchitectureNode } from "@/lib/architecture/schema";
import { buildArchitectureDetail } from "./detailModel";

export function ArchitectureDetails({ node, onClose }: { node?: ArchitectureNode; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  if (!node) return null; const detail = buildArchitectureDetail(node);
  return <aside className="arch-details" aria-label="Architecture component details">
    <button type="button" aria-label="Close architecture details" className="arch-details__close" onClick={onClose}>×</button>
    <p className="arch-details__eyebrow">{detail.kind} · {detail.layer}</p><h2>{detail.name}</h2><p className="arch-details__summary">{detail.summary}</p>
    <dl>{detail.runtime ? <><dt>Runtime</dt><dd>{detail.runtime}</dd></> : null}{detail.model ? <><dt>Model</dt><dd>{detail.model}</dd></> : null}<dt>State</dt><dd>{detail.stateLifetime}</dd><dt>Data scope</dt><dd>{detail.dataScope}</dd><dt>Authority</dt><dd>{detail.authorities.join(", ")}</dd>{detail.promptResponsibility ? <><dt>Instruction boundary</dt><dd>{detail.promptResponsibility}</dd></> : null}{detail.approval ? <><dt>Approval</dt><dd>{detail.approval}</dd></> : null}{detail.idempotency ? <><dt>Idempotency</dt><dd>{detail.idempotency}</dd></> : null}{detail.verification ? <><dt>Verification</dt><dd>{detail.verification}</dd></> : null}</dl>
    <p className="arch-details__authority">{detail.authorityNote}</p>
    {detail.representativeRoutes?.length ? <section><h3>Representative routes</h3><code>{detail.representativeRoutes.join("\n")}</code></section> : null}
    {detail.sourceFiles?.length ? <section><h3>Source</h3><code>{detail.sourceFiles.join("\n")}</code></section> : null}
    {detail.docs?.length ? <section><h3>Documentation</h3><div className="arch-details__links">{detail.docs.map((doc) => <a key={doc} href={`/docs/${doc}`}>{doc}</a>)}</div></section> : null}
    {detail.limitations?.length ? <section><h3>Limitations</h3><ul>{detail.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    <button type="button" onClick={() => navigator.clipboard?.writeText(`${location.origin}${location.pathname}${detail.deepLink}`)}>Copy deep link</button>
  </aside>;
}
