"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import DashboardOverviewClient from "./DashboardOverviewClient";

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function run() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      const { data: isAdmin, error } = await supabase.rpc("is_admin");
      if (error) {
        console.error("is_admin error:", error);
        setReady(true);
        return;
      }

      if (isAdmin) {
        router.replace("/admin");
        return;
      }

      setReady(true);
    }

    void run();
  }, [router]);

  if (!ready) return <div className="p-6">Loading...</div>;

  return <DashboardOverviewClient />;
}