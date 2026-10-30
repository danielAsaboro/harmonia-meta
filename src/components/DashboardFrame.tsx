"use client";

import { usePathname } from "next/navigation";
import ChatDrawer from "@/components/ChatDrawer";
import NavRail from "@/components/NavRail";

export default function DashboardFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const nonStudioRoots = ["/dashboard/calendar", "/dashboard/notifications", "/dashboard/monitoring", "/dashboard/settings"];
  const isStudio = (pathname === "/dashboard" || pathname === "/dashboard/" || pathname.startsWith("/dashboard/"))
    && !nonStudioRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
  return (
    <>
      <NavRail />
      <main
        className={isStudio ? "dashboard-app dash-studio h-dvh w-full overflow-hidden" : "dashboard-app dashboard-shell"}
        data-dashboard-mode={isStudio ? "studio" : "page"}
      >
        <div className={isStudio ? "h-full" : "mx-auto w-full max-w-6xl"}>{children}</div>
      </main>
      {!isStudio ? <ChatDrawer /> : null}
    </>
  );
}
