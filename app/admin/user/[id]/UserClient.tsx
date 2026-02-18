"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AnyRow = Record<string, any>;

function isUuid(v: any) {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isNonEmptyText(v: any) {
  return typeof v === "string" && v.trim().length > 0;
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
}

export default function UserClient({ userId }: { userId: string }) {
  const router = useRouter();

  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [profile, setProfile] = useState<AnyRow | null>(null);
  const [prompts, setPrompts] = useState<AnyRow[]>([]);
  const [entries, setEntries] = useState<AnyRow[]>([]);

  useEffect(() => {
    async function boot() {
      setMessage(null);

      // HARD GUARD: if invalid, stop before any Supabase call.
      if (!isUuid(userId)) {
        console.error("Admin user view invalid userId:", userId);
        setMessage(`Invalid user id received: "${userId}"`);
        setCheckingAdmin(false);
        setLoading(false);
        return;
      }

      console.log("Admin user view userId:", userId);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin");
      if (adminErr) {
        setMessage(`Admin check error: ${adminErr.message}`);
        setCheckingAdmin(false);
        setLoading(false);
        return;
      }

      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }

      setCheckingAdmin(false);

      // Profile
      const profRes = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profRes.error) {
        console.error("Profile load error details:", profRes.error);
        setMessage(`Profile load error: ${profRes.error.message}`);
        setLoading(false);
        return;
      }

      setProfile(profRes.data ?? null);

      // Prompts
      const promptRes = await supabase
        .from("prompts")
        .select("week, title, active")
        .eq("active", true)
        .order("week", { ascending: true });

      if (promptRes.error) {
        console.error("Prompt load error details:", promptRes.error);
        setMessage(`Prompt load error: ${promptRes.error.message}`);
      } else {
        setPrompts(promptRes.data ?? []);
      }

      // Entries for that user
      const entryRes = await supabase
        .from("entries")
        .select("id, user_id, week, content, status, updated_at, created_at")
        .eq("user_id", userId)
        .order("week", { ascending: true });

      if (entryRes.error) {
        console.error("Entry load error details:", entryRes.error);
        setMessage(`Entry load error: ${entryRes.error.message}`);
      } else {
        setEntries(entryRes.data ?? []);
      }

      setLoading(false);
    }

    void boot();
  }, [router, userId]);

  const promptCount = useMemo(() => (prompts.length > 0 ? prompts.length : 52), [prompts.length]);

  const promptTitleByWeek = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of prompts) {
      const w = Number(p.week);
      const t = String(p.title ?? "");
      if (w) m.set(w, t || `Week ${w}`);
    }
    return m;
  }, [prompts]);

  const entryByWeek = useMemo(() => {
    const m = new Map<number, AnyRow>();
    for (const e of entries) {
      const w = Number(e.week);
      if (w) m.set(w, e);
    }
    return m;
  }, [entries]);

  const weeks = useMemo(() => {
    const out: Array<{
      week: number;
      title: string;
      status: "Open" | "In Progress" | "Complete";
      updated_at: string | null;
      content: string;
    }> = [];

    for (let w = 1; w <= promptCount; w++) {
      const e = entryByWeek.get(w);
      const title = promptTitleByWeek.get(w) ?? `Week ${w}`;

      const hasText = e && isNonEmptyText(e.content);
      const status =
        !e || !hasText ? "Open" : String(e.status) === "complete" ? "Complete" : "In Progress";

      const updated = (e?.updated_at as string | null) ?? (e?.created_at as string | null) ?? null;

      out.push({
        week: w,
        title,
        status,
        updated_at: updated,
        content: (e?.content as string) ?? ""
      });
    }

    return out;
  }, [promptCount, entryByWeek, promptTitleByWeek]);

  function exportJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      user: {
        id: userId,
        preferred_name: profile?.preferred_name ?? null,
        email: profile?.email ?? null,
        start_date: profile?.start_date ?? null
      },
      entries: weeks.map((w) => ({
        week: w.week,
        prompt_title: w.title,
        status: w.status,
        content: w.content,
        updated_at: w.updated_at
      }))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `user-${userId}-autobiography.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  if (checkingAdmin) return <div className="p-6">Checking admin access...</div>;
  if (loading) return <div className="p-6">Loading user...</div>;

  const cardClass = "border rounded-xl p-4";
  const buttonClass = "rounded-lg border px-3 py-2";
  const thClass = "py-2 px-3 text-xs";
  const tdClass = "py-2 px-3 text-sm";

  function rowBg(status: string) {
    if (status === "Complete") return "bg-green-100";
    if (status === "In Progress") return "bg-blue-100";
    return "bg-white";
  }

  function statusColor(status: string) {
    if (status === "Complete") return "text-green-800";
    if (status === "In Progress") return "text-blue-800 italic";
    return "text-black";
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm opacity-80 cursor-pointer" onClick={() => router.push("/admin")}>
              Admin
            </div>
            <h1 className="text-2xl font-semibold">
              {(profile?.preferred_name as string) ?? "User"}{" "}
              <span className="text-sm opacity-70">({userId})</span>
            </h1>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button className={buttonClass} onClick={() => router.push("/admin")}>
              Back to Admin
            </button>
            <button className={buttonClass} onClick={exportJson}>
              Export JSON
            </button>
          </div>
        </div>

        {message ? <div className={cardClass}>{message}</div> : null}

        <div className={cardClass}>
          <div className="text-sm opacity-80">Email: {profile?.email ?? "-"}</div>
          <div className="text-sm opacity-80">Start date: {profile?.start_date ?? "-"}</div>
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-lg font-semibold">Weeks</div>
            <div className="text-sm opacity-80">{weeks.length} total</div>
          </div>

          <div className="mt-3 border rounded-lg overflow-hidden">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b">
                    <th className={thClass}>Week</th>
                    <th className={thClass}>Prompt</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Updated</th>
                    <th className={thClass}>Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.week} className={`border-b ${rowBg(w.status)}`}>
                      <td className={tdClass}>{w.week}</td>
                      <td className={tdClass}>{w.title}</td>
                      <td className={`${tdClass} ${statusColor(w.status)}`}>{w.status}</td>
                      <td className={tdClass}>{formatDateTime(w.updated_at)}</td>
                      <td className={tdClass}>
                        {isNonEmptyText(w.content)
                          ? w.content.slice(0, 90) + (w.content.length > 90 ? "..." : "")
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 text-xs opacity-70">Admin view is read-only for now.</div>
        </div>
      </div>
    </div>
  );
}