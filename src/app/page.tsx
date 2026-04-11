import { AppShell } from "@/components/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";

export default function HomePage() {
  return (
    <AppShell>
      <DashboardOverview />
    </AppShell>
  );
}
