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

      // Not logged in
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      // Admin redirect
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

      // Disabled user gate
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("disabled")
        .eq("id", auth.user.id)
        .single();

      if (profErr) {
        console.error("profiles disabled check error:", profErr);
        setReady(true);
        return;
      }

      if (prof?.disabled) {
        await supabase.auth.signOut();
        router.replace("/disabled");
        return;
      }

      setReady(true);
    }

    void run();
  }, [router]);

  if (!ready) return <div className="p-6">Loading...</div>;

  return <DashboardOverviewClient />;
}