import SettingsView from "@/components/SettingsView";
import { DashboardPage } from "@/components/dashboard/DashboardPage";

export default function SettingsPage() {
  return (
    <DashboardPage title="Settings" eyebrow="Workspace control center" description="Configure strategy, approved channels, operator access, and service health.">
      <SettingsView />
    </DashboardPage>
  );
}
