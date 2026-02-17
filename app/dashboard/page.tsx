import { redirect } from "next/navigation";
import { Suspense } from "react";
import DashboardOverviewClient from "./DashboardOverviewClient";

export default function DashboardPage({
  searchParams
}: {
  searchParams: { week?: string };
}) {
  if (searchParams?.week) {
    redirect(`/week?week=${encodeURIComponent(searchParams.week)}`);
  }

  return (
    <Suspense fallback={<div className="p-6">Loading dashboard...</div>}>
      <DashboardOverviewClient />
    </Suspense>
  );
}