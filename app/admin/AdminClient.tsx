"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Row = {
  id: string;
  email: string | null;
  preferred_name: string | null;
  start_date: string | null;
  current_week: number | null;

  email_paused: boolean;
  disabled: boolean;

  open_count: number;
  in_progress_count: number;
  complete_count: number;
  percent_complete: number;
  last_activity: string | null;
};

type SortKey =
  | "preferred_name"
  | "email"
  | "percent_complete"
  | "complete_count"
  | "in_progress_count"
  | "open_count"
  | "current_week"
  | "last_activity"
  | "email_paused"
  | "disabled";

type FilterKey = "all" | "needs_attention" | "ready" | "paused" | "disabled";

function formatDateTime(d: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
}

function daysSince(d: string | null) {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  const ms = Date.now() - t;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function safeReadJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json().catch(() => null);
  const text = await res.text().catch(() => "");
  return { ok: false, error: text ? text.slice(0, 300) : "Non-JSON response" };
}

export default function AdminClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("last_activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [filter, setFilter] = useState<FilterKey>("all");

  async function fetchOverview() {
    setLoading(true);
    setMessage(null);

    const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) {
      setMessage("Session error: " + sessErr.message);
      setLoading(false);
      return;
    }

    const token = sessionRes?.session?.access_token;
    if (!token) {
      setMessage("No session token. Please sign in again.");
      setLoading(false);
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/admin/users-overview", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    const json = await safeReadJson(res);

    if (!res.ok || !json?.ok) {
      const errText = json?.error ?? json?.message ?? "Unknown error.";
      setMessage(`Users overview failed (HTTP ${res.status}): ${errText}`);
      setLoading(false);
      return;
    }

    setRows((json.result ?? []) as Row[]);
    setLoading(false);
  }

  async function adminAction(payload: any) {
    setMessage(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes?.session?.access_token;

    if (!token) {
      setMessage("No session token. Please sign in again.");
      return { ok: false };
    }

    const res = await fetch("/api/admin/user-actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const json = await safeReadJson(res);

    if (!res.ok || !json?.ok) {
      setMessage(`Admin action failed (HTTP ${res.status}): ${json?.error ?? "Unknown error"}`);
      return { ok: false };
    }

    return { ok: true };
  }

  async function adminAuthAction(payload: any) {
    setMessage(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes?.session?.access_token;

    if (!token) {
      setMessage("No session token. Please sign in again.");
      return { ok: false };
    }

    const res = await fetch("/api/admin/auth-actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const json = await safeReadJson(res);

    if (!res.ok || !json?.ok) {
      setMessage(`Admin auth action failed (HTTP ${res.status}): ${json?.error ?? "Unknown error"}`);
      return { ok: false };
    }

    return { ok: true };
  }

  useEffect(() => {
    void fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(k);
    setSortDir(k === "preferred_name" || k === "email" ? "asc" : "desc");
  }

  // ===== Summary bar stats =====
  const summary = useMemo(() => {
    const total = rows.length;
    const paused = rows.filter((r) => r.email_paused).length;
    const disabled = rows.filter((r) => r.disabled).length;
    const ready = rows.filter((r) => r.complete_count >= 52).length;
    const needsAttention = rows.filter((r) => {
      const d = daysSince(r.last_activity);
      return d !== null && d >= 14 && r.complete_count < 52 && !r.disabled;
    }).length;

    return { total, paused, disabled, ready, needsAttention };
  }, [rows]);

  // ===== Filtered rows =====
  const filteredRows = useMemo(() => {
    const isNeedsAttention = (r: Row) => {
      const d = daysSince(r.last_activity);
      return d !== null && d >= 14 && r.complete_count < 52 && !r.disabled;
    };

    if (filter === "all") return rows;
    if (filter === "needs_attention") return rows.filter(isNeedsAttention);
    if (filter === "ready") return rows.filter((r) => r.complete_count >= 52);
    if (filter === "paused") return rows.filter((r) => r.email_paused && !r.disabled);
    if (filter === "disabled") return rows.filter((r) => r.disabled);
    return rows;
  }, [rows, filter]);

  // ===== Sort after filter =====
  const sorted = useMemo(() => {
    const copy = [...filteredRows];

    function cmp(a: Row, b: Row) {
      const dir = sortDir === "asc" ? 1 : -1;

      if (sortKey === "last_activity") {
        const at = a.last_activity ? new Date(a.last_activity).getTime() : 0;
        const bt = b.last_activity ? new Date(b.last_activity).getTime() : 0;
        return (at - bt) * dir;
      }

      const av: any = (a as any)[sortKey];
      const bv: any = (b as any)[sortKey];

      if (sortKey === "preferred_name" || sortKey === "email") {
        const as = String(av ?? "").toLowerCase();
        const bs = String(bv ?? "").toLowerCase();
        if (as < bs) return -1 * dir;
        if (as > bs) return 1 * dir;
        return 0;
      }

      if (sortKey === "email_paused" || sortKey === "disabled") {
        const an = av ? 1 : 0;
        const bn = bv ? 1 : 0;
        return (an - bn) * dir;
      }

      const an = Number(av ?? 0);
      const bn = Number(bv ?? 0);
      return (an - bn) * dir;
    }

    copy.sort(cmp);
    return copy;
  }, [filteredRows, sortKey, sortDir]);

  const th = "px-3 py-2 text-xs font-semibold border-b cursor-pointer select-none";
  const td = "px-3 py-2 text-sm border-b align-top";
  const btn = "px-2 py-1 border rounded-md text-xs";

  const filterBtn = (k: FilterKey) =>
    `px-3 py-2 border rounded-lg text-sm ${filter === k ? "font-semibold" : ""}`;

  if (loading) return <div className="p-6">Loading admin dashboard...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <div className="flex gap-2">
          <button className={btn} onClick={fetchOverview}>
            Refresh
          </button>
          <button
            className={btn}
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="border rounded-xl p-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="px-3 py-2 border rounded-lg">
            <div className="text-xs opacity-70">Users</div>
            <div className="font-semibold">{summary.total}</div>
          </div>

          <div className="px-3 py-2 border rounded-lg">
            <div className="text-xs opacity-70">Needs attention (14+ days)</div>
            <div className="font-semibold">{summary.needsAttention}</div>
          </div>

          <div className="px-3 py-2 border rounded-lg">
            <div className="text-xs opacity-70">Ready (52 complete)</div>
            <div className="font-semibold">{summary.ready}</div>
          </div>

          <div className="px-3 py-2 border rounded-lg">
            <div className="text-xs opacity-70">Emails paused</div>
            <div className="font-semibold">{summary.paused}</div>
          </div>

          <div className="px-3 py-2 border rounded-lg">
            <div className="text-xs opacity-70">Disabled</div>
            <div className="font-semibold">{summary.disabled}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="border rounded-xl p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="text-xs opacity-70 mr-2">Filter</div>

          <button className={filterBtn("all")} onClick={() => setFilter("all")}>
            All ({summary.total})
          </button>

          <button
            className={filterBtn("needs_attention")}
            onClick={() => setFilter("needs_attention")}
          >
            Needs attention ({summary.needsAttention})
          </button>

          <button className={filterBtn("ready")} onClick={() => setFilter("ready")}>
            Ready ({summary.ready})
          </button>

          <button className={filterBtn("paused")} onClick={() => setFilter("paused")}>
            Emails paused ({summary.paused})
          </button>

          <button className={filterBtn("disabled")} onClick={() => setFilter("disabled")}>
            Disabled ({summary.disabled})
          </button>

          <div className="ml-auto text-xs opacity-70">
            Showing {sorted.length} of {rows.length}
          </div>
        </div>
      </div>

      {message ? <div className="border rounded-xl p-3">{message}</div> : null}

      <div className="border rounded-xl overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-left">
            <thead className="bg-white sticky top-0">
              <tr>
                <th className={th} onClick={() => toggleSort("preferred_name")}>
                  Name
                </th>
                <th className={th} onClick={() => toggleSort("email")}>
                  Email
                </th>
                <th className={th} onClick={() => toggleSort("percent_complete")}>
                  Progress
                </th>
                <th className={th} onClick={() => toggleSort("current_week")}>
                  Current week
                </th>
                <th className={th} onClick={() => toggleSort("complete_count")}>
                  Complete
                </th>
                <th className={th} onClick={() => toggleSort("in_progress_count")}>
                  In progress
                </th>
                <th className={th} onClick={() => toggleSort("open_count")}>
                  Open
                </th>
                <th className={th} onClick={() => toggleSort("last_activity")}>
                  Last activity
                </th>
                <th className={th} onClick={() => toggleSort("email_paused")}>
                  Emails
                </th>
                <th className={th} onClick={() => toggleSort("disabled")}>
                  Status
                </th>
                <th className="px-3 py-2 text-xs font-semibold border-b">Actions</th>
              </tr>
            </thead>

            <tbody>
              {sorted.map((r) => {
                const inactiveDays = daysSince(r.last_activity);
                const needsAttention =
                  inactiveDays !== null && inactiveDays >= 14 && r.complete_count < 52 && !r.disabled;
                const isDone = r.complete_count >= 52;

                return (
                  <tr key={r.id} className={r.disabled ? "opacity-60" : ""}>
                    <td className={td}>
                      <div className="font-semibold">{r.preferred_name ?? "(No name)"}</div>
                      {isDone ? (
                        <div className="text-xs text-green-700">Ready (52 complete)</div>
                      ) : needsAttention ? (
                        <div className="text-xs text-red-700">
                          Attention ({inactiveDays} days inactive)
                        </div>
                      ) : (
                        <div className="text-xs opacity-70">-</div>
                      )}
                    </td>

                    <td className={td}>{r.email ?? "-"}</td>

                    <td className={td}>
                      <div className="text-sm">{r.percent_complete}%</div>
                      <div className="text-xs opacity-70">{r.complete_count}/52 complete</div>
                    </td>

                    <td className={td}>{r.current_week ?? "-"}</td>
                    <td className={td}>{r.complete_count}</td>
                    <td className={td}>{r.in_progress_count}</td>
                    <td className={td}>{r.open_count}</td>
                    <td className={td}>{formatDateTime(r.last_activity)}</td>

                    <td className={td}>
                      <div className="text-xs">
                        {r.email_paused ? (
                          <span className="text-orange-700">Paused</span>
                        ) : (
                          <span className="text-green-700">Active</span>
                        )}
                      </div>
                    </td>

                    <td className={td}>
                      <div className="text-xs">
                        {r.disabled ? (
                          <span className="text-red-700">Disabled</span>
                        ) : (
                          <span className="text-green-700">Enabled</span>
                        )}
                      </div>
                    </td>

                    <td className={td}>
                      <div className="flex flex-col gap-2">
                        <button className={btn} onClick={() => router.push(`/admin/user/${r.id}`)}>
                          View
                        </button>

                        <button
                          className={btn}
                          onClick={async () => {
                            const ok = window.confirm(
                              r.email_paused
                                ? "Resume weekly emails for this user?"
                                : "Pause weekly emails for this user?"
                            );
                            if (!ok) return;

                            const res = await adminAction({
                              action: "set_email_paused",
                              target_user_id: r.id,
                              email_paused: !r.email_paused
                            });

                            if (res.ok) await fetchOverview();
                          }}
                        >
                          {r.email_paused ? "Resume emails" : "Pause emails"}
                        </button>

                        <button
                          className={btn}
                          onClick={async () => {
                            const ok = window.confirm(
                              r.disabled
                                ? "Enable this user?"
                                : "Disable this user? They will be blocked from the app."
                            );
                            if (!ok) return;

                            const res = await adminAuthAction({
                              action: "set_disabled",
                              target_user_id: r.id,
                              disabled: !r.disabled
                            });

                            if (res.ok) await fetchOverview();
                          }}
                        >
                          {r.disabled ? "Enable user" : "Disable user"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {sorted.length === 0 ? (
                <tr>
                  <td className="p-6 text-sm opacity-70" colSpan={11}>
                    No users found for this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs opacity-60">Tip: click column headers to sort.</div>
    </div>
  );
}