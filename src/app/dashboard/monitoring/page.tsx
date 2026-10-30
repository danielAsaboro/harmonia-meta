"use client";

import { useState, useSyncExternalStore } from "react";
import MonitoringView from "@/components/MonitoringView";
import LogsView from "@/components/monitoring/LogsView";
import JobsTableView from "@/components/monitoring/JobsTableView";
import AssetsGallery from "@/components/monitoring/AssetsGallery";
import ReceiptsLedger from "@/components/monitoring/ReceiptsLedger";
import AgentActivityView from "@/components/monitoring/AgentActivityView";
import WorkflowActivityView from "@/components/monitoring/WorkflowActivityView";
import AutonomousOperationsView from "@/components/AutonomousOperationsView";
import ProposalsView from "@/components/ProposalsView";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { AlertBanner } from "@/components/dashboard/SystemState";
import { Tabs } from "@/components/dashboard/Tabs";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "autonomy", label: "Autonomy" },
  { key: "proposals", label: "Proposals" },
  { key: "agents", label: "Agents" },
  { key: "logs", label: "Logs" },
  { key: "activity", label: "Agent activity" },
  { key: "jobs", label: "Jobs" },
  { key: "assets", label: "Assets" },
  { key: "receipts", label: "Receipts" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function MonitoringPage() {
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const requested = mounted ? new URL(window.location.href).searchParams.get("tab") : null;
  const urlTab = TABS.some((item) => item.key === requested) ? requested as Tab : "overview";
  const tab = selectedTab ?? urlTab;

  const selectTab = (next: Tab) => {
    setSelectedTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  return (
    <DashboardPage title="Monitoring" description="Follow pipeline health, agent handoffs, tool calls, generated assets, and independently verified external effects." eyebrow="Operational control center">
      <AlertBanner tone="warning" title="Human authority remains in force">
        Agents may research, draft, and propose work here. Publishing, unknown-effect resolution, and other material actions still require an authenticated operator decision and audit receipt.
      </AlertBanner>
      <div className="monitoring-tabs">
        <Tabs items={TABS} selected={tab} onSelect={selectTab} label="Monitoring sections" />
      </div>
      <div className="monitoring-panel" role="tabpanel" aria-label={TABS.find((item) => item.key === tab)?.label}>
        {tab === "overview" && <MonitoringView />}
        {tab === "autonomy" && <AutonomousOperationsView />}
        {tab === "proposals" && <ProposalsView />}
        {tab === "agents" && <WorkflowActivityView />}
        {tab === "logs" && <LogsView />}
        {tab === "activity" && <AgentActivityView />}
        {tab === "jobs" && <JobsTableView />}
        {tab === "assets" && <AssetsGallery />}
        {tab === "receipts" && <ReceiptsLedger />}
      </div>
    </DashboardPage>
  );
}
