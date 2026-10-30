import type { Metadata } from "next";
import { Suspense } from "react";
import "@xyflow/react/dist/style.css";
import { ArchitectureExplorer } from "@/components/architecture/ArchitectureExplorer";
import "./architecture.css";

export const metadata: Metadata = {
  title: "Architecture explorer · Harmonia docs",
  description: "Explore Harmonia's agents, workflows, models, tools, routes, state, effects, and trust boundaries.",
};

export default function PublicArchitecturePage() {
  return (
    <Suspense fallback={<div className="architecture-loading">Loading architecture…</div>}>
      <ArchitectureExplorer />
    </Suspense>
  );
}
