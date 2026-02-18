"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AnyRow = Record<string, any>;

type UserRow = {
  id: string; // must be uuid string
  email?: string | null;
  preferred_name?: string | null;
  start_date?: string | null;
  complete: number;
  in_progress: number;
  open: number;
  last_activity?: string | null;
};

function isNonEmptyText(v: any) {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: any) {
  if (typeof v !== "string") return false;
  // Standard UUID v1-5 format
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
}

function formatDate(d: string | null | undefined) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
}

export default function AdminClient() {
  const router = useRouter();

  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<AnyRow[]>([]);
  const [prompts, setPrompts] = useState<AnyRow[]>([]);
  const [entries, setEntries] = useState<AnyRow[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    async function boot() {
      setMessage(null);

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

      const { data: promptRows, error: promptErr } = await supabase
        .from("prompts")
        .select("week, title, active")
        .eq("active", true)
        .order("week", { ascending: true });

      if (promptErr) setMessage(`Prompt load error: ${promptErr.message}`);
      setPrompts(promptRows ?? []);

      const { data: profileRows, error: profErr } = await supabase
        .from("profiles")
        .select("id, email, preferred_name, start_date, created_at")
        .order("created_at", { ascending: false });

      if (profErr) setMessage(`Profile load error: ${profErr.message}`);
      setProfiles(profileRows ?? []);

      const { data: entryRows, error: entryErr } = await supabase
        .from("entries")
        .select("id, user_id, week, content, status, updated_at, created_at");

      if (entryErr) setMessage(`Entry load error: ${entryErr.message}`);
      setEntries(entryRows ?? []);

      setLoading(false);
    }

    void boot();
  }, [router]);

  const promptCount = useMemo(() => (prompts.length > 0 ? prompts.length : 52), [prompts.length]);

  const users: UserRow[] = useMemo(() => {
    // Map entries by user_id and week
    const byUser = new Map<string, Map<number, AnyRow>>();
    for (const e of entries) {
      const uid = typeof e.user_id === "string" ? e.user_id : "";
      const week = Number(e.week);
      if (!uid || !week) continue;
      if (!byUser.has(uid)) byUser.set(uid, new Map());
      byUser.get(uid)!.set(week, e);
    }

    const out: UserRow[] = profiles.map((p) => {
      const rawId = p.id;
      const id = typeof rawId === "string" ? rawId : "";

      const perWeek = byUser.get(id) ?? new Map<number, AnyRow>();

      let complete = 0;
      let in_progress = 0;
      let last_activity: string | null = null;

      for (let w = 1; w <= promptCount; w++) {
        const e = perWeek.get(w);
        if (!e || !isNonEmptyText(e.content)) continue;

        if (String(e.status) === "complete") complete += 1;
        else in_progress += 1;

        const updated = (e.updated_at as string | null) ?? (e.created_at as string | null) ?? null;
        if (updated) {
          if (!last_activity) last_activity = updated;
          else {
            const a = new Date(last_activity).getTime();
            const b = new Date(updated).getTime();
            if (b > a) last_activity = updated;
          }
        }
      }

      const open = Math.max(0, promptCount - (complete + in_progress));

      return {
        id,
        email: (p.email as string | null) ?? null,
        preferred_name: (p.preferred_name as string | null) ?? null,
        start_date: (p.start_date as string | null) ?? null,
        complete,
        in_progress,
        open,
        last_activity
      };
    });

    // Sort by last activity desc
    out.sort((a, b) => {
      const ta = a.last_activity ? new Date(a.last_activity).getTime() : 0;
      const tb = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      return tb - ta;
    });

    return out;
  }, [profiles, entries, promptCount]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;

    return users.filter((u) => {
      const email = (u.email ?? "").toLowerCase();
      const name = (u.preferred_name ?? "").toLowerCase();
      const id = (u.id ?? "").toLowerCase();
      return email.includes(q) || name.includes(q) || id.includes(q);
    });
  }, [users, query]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (checkingAdmin) return <div className="p-6">Checking admin access...</div>;
  if (loading) return <div className="p-6">Loading admin dashboard...</div>;

  const cardClass = "border rounded-xl p-4";
  const buttonClass = "rounded-lg border px-3 py-2";
  const thClass = "py-2 px-3 text-xs";
  const tdClass = "py-2 px-3 text-sm";

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Admin</h1>
            <div className="text-sm opacity-80">User administration and progress review</div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button className={buttonClass} onClick={() => router.push("/dashboard")}>
              View user dashboard
            </button>
            <button className={buttonClass} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {message ? <div className={cardClass}>{message}</div> : null}

        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="font-semibold">Users</div>
            <div className="text-sm opacity-80">{filtered.length} shown</div>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input
              className="border rounded-lg px-3 py-2 w-full md:w-[420px]"
              placeholder="Search by email, preferred name, or id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="text-xs opacity-70">Prompts counted: {promptCount}</div>
          </div>

          <div className="mt-3 border rounded-lg overflow-hidden">
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b">
                    <th className={thClass}>Preferred name</th>
                    <th className={thClass}>Email</th>
                    <th className={thClass}>User ID</th>
                    <th className={thClass}>Start date</th>
                    <th className={thClass}>Complete</th>
                    <th className={thClass}>In Progress</th>
                    <th className={thClass}>Open</th>
                    <th className={thClass}>Last activity</th>
                    <th className={thClass}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const canView = isUuid(u.id);

                    return (
                      <tr key={`${u.email ?? ""}-${u.id ?? ""}`} className="border-b hover:bg-slate-50">
                        <td className={tdClass}>{u.preferred_name ?? "-"}</td>
                        <td className={tdClass}>{u.email ?? "-"}</td>
                        <td className={tdClass}>{u.id || "-"}</td>
                        <td className={tdClass}>{formatDate(u.start_date)}</td>
                        <td className={tdClass}>{u.complete}</td>
                        <td className={tdClass}>{u.in_progress}</td>
                        <td className={tdClass}>{u.open}</td>
                        <td className={tdClass}>{formatDateTime(u.last_activity)}</td>
                        <td className={tdClass}>
                          <button
                            className="rounded border px-3 py-1.5 text-sm"
                            disabled={!canView}
                            onClick={() => {
                              if (!canView) return;
                              router.push(`/admin/user/${u.id}`);
                            }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {filtered.length === 0 ? (
                    <tr>
                      <td className="p-3 text-sm opacity-80" colSpan={9}>
                        No users match your search.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 text-xs opacity-70">
            If any row shows a blank or non-UUID User ID, that profile record is invalid and should be deleted.
          </div>
        </div>
      </div>
    </div>
  );
}