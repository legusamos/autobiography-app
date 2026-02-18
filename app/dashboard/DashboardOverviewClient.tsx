"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type PromptRow = {
  prompt_key: string;
  week: number;
  title: string;
};

type EntryRow = {
  id: string;
  week: number;
  content: string;
  status: string | null;
  updated_at?: string;
};

type ProfileRow = {
  start_date: string | null;
};

type EntryStatusMode = "in_progress" | "complete";
type DisplayStatus = "Open" | "In Progress" | "Complete";

function clampWeek(n: number) {
  return Math.max(1, Math.min(52, n));
}

function weekFromStartDate(startDateISO: string) {
  const start = new Date(startDateISO + "T00:00:00Z");
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((now.getTime() - start.getTime()) / msPerDay);
  return clampWeek(Math.floor(days / 7) + 1);
}

function addDays(date: Date, days: number) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatDateShort(d: Date) {
  try {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function normalizeEntryStatus(raw: string | null | undefined): EntryStatusMode {
  if (raw === "complete") return "complete";
  return "in_progress";
}

function deriveDisplayStatus(entry: EntryRow | undefined): DisplayStatus {
  if (!entry) return "Open";
  const hasText = (entry.content ?? "").trim().length > 0;
  if (!hasText) return "Open";
  return normalizeEntryStatus(entry.status) === "complete" ? "Complete" : "In Progress";
}

function statusRank(s: DisplayStatus) {
  if (s === "Open") return 0;
  if (s === "In Progress") return 1;
  return 2;
}

export default function DashboardOverviewClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [currentWeek, setCurrentWeek] = useState<number>(1);

  const [busyWeek, setBusyWeek] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMessage(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.push("/login");
        return;
      }

      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("start_date")
        .eq("id", auth.user.id)
        .single();

      if (profErr) {
        setMessage(`Profile load error: ${profErr.message}`);
        setLoading(false);
        return;
      }

      const prof = profile as ProfileRow;
      setStartDate(prof?.start_date ?? null);

      if (prof?.start_date) setCurrentWeek(weekFromStartDate(prof.start_date));
      else setCurrentWeek(1);

      const { data: promptRows, error: promptErr } = await supabase
        .from("prompts")
        .select("prompt_key, week, title")
        .eq("active", true)
        .order("week", { ascending: true });

      if (promptErr) {
        setMessage(`Prompt list error: ${promptErr.message}`);
        setLoading(false);
        return;
      }

      const { data: entryRows, error: entryErr } = await supabase
        .from("entries")
        .select("id, week, content, status, updated_at")
        .eq("user_id", auth.user.id);

      if (entryErr) {
        setMessage(`Entry list error: ${entryErr.message}`);
        setLoading(false);
        return;
      }

      setPrompts((promptRows ?? []) as PromptRow[]);
      setEntries((entryRows ?? []) as EntryRow[]);
      setLoading(false);
    }

    void load();
  }, [router]);

  const entryByWeek = useMemo(() => {
    const m = new Map<number, EntryRow>();
    for (const e of entries) m.set(e.week, e);
    return m;
  }, [entries]);

  // Lifecycle counts
  const lifecycle = useMemo(() => {
    let answered = 0;
    let complete = 0;

    for (const e of entryByWeek.values()) {
      const hasText = (e.content ?? "").trim().length > 0;
      if (!hasText) continue;
      answered += 1;
      if (normalizeEntryStatus(e.status) === "complete") complete += 1;
    }

    const inProgress = Math.max(0, answered - complete);
    const remaining = Math.max(0, 52 - complete);

    return { answered, inProgress, complete, remaining };
  }, [entryByWeek]);

  const progressPct = useMemo(() => {
    return Math.round((lifecycle.complete / 52) * 100);
  }, [lifecycle.complete]);

  const startEndDates = useMemo(() => {
    if (!startDate) return { startText: "-", endText: "-" };
    const start = new Date(startDate + "T00:00:00Z");
    // 52 weeks total: week 1 is start date; projected end is start + 51*7 days
    const projectedEnd = addDays(start, 51 * 7);
    return {
      startText: formatDateShort(start),
      endText: formatDateShort(projectedEnd)
    };
  }, [startDate]);

  const rows = useMemo(() => {
    const base = startDate ? new Date(startDate + "T00:00:00Z") : null;

    const computed = prompts.map((p) => {
      const e = entryByWeek.get(p.week);
      const displayStatus = deriveDisplayStatus(e);
      const scheduled = base ? addDays(base, (p.week - 1) * 7) : null;

      return {
        week: p.week,
        title: p.title,
        scheduledText: scheduled ? formatDateShort(scheduled) : "-",
        displayStatus,
        canToggle: displayStatus !== "Open"
      };
    });

    // Open first, then In Progress, then Complete; newest first within each bucket
    computed.sort((a, b) => {
      const ra = statusRank(a.displayStatus);
      const rb = statusRank(b.displayStatus);
      if (ra !== rb) return ra - rb;
      return b.week - a.week;
    });

    return computed;
  }, [prompts, entryByWeek, startDate]);

  function goToWeek(week: number) {
    router.push(`/week?week=${week}`);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function toggleComplete(week: number) {
    const e = entryByWeek.get(week);
    if (!e) return;

    const hasText = (e.content ?? "").trim().length > 0;
    if (!hasText) return;

    const current = normalizeEntryStatus(e.status);
    const next: EntryStatusMode = current === "complete" ? "in_progress" : "complete";

    setBusyWeek(week);
    setMessage(null);

    const { error } = await supabase.from("entries").update({ status: next }).eq("id", e.id);

    if (error) {
      setMessage(`Status update error: ${error.message}`);
      setBusyWeek(null);
      return;
    }

    setEntries((prev) => prev.map((row) => (row.id === e.id ? { ...row, status: next } : row)));
    setBusyWeek(null);
  }

  if (loading) return <div className="p-6">Loading dashboard...</div>;

  const cardClass = "border rounded-xl p-4";
  const buttonClass = "rounded-lg border px-3 py-2";

  function statusClass(status: DisplayStatus) {
    if (status === "Complete") return "text-green-700 font-semibold";
    if (status === "In Progress") return "text-blue-700 font-medium";
    return "text-gray-600";
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Dashboard</h1>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button className={buttonClass} onClick={() => router.push("/profile")}>
              Profile
            </button>
            <button className={buttonClass} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {/* Lifecycle + Progress */}
        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="font-semibold">
              Progress: {lifecycle.complete} of 52 complete
            </div>
            <div className="text-sm opacity-80">{progressPct}%</div>
          </div>

          <div className="mt-3 w-full border rounded-lg h-4 overflow-hidden bg-white">
            <div
              className="h-4 bg-green-600 transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>

          {/* Start / Projected End dates */}
          <div className="flex items-center justify-between gap-3 mt-2 text-xs opacity-80">
            <div>Start date: {startEndDates.startText}</div>
            <div>Projected end date: {startEndDates.endText}</div>
          </div>

          {/* Lifecycle intelligence */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">Answered</div>
              <div className="text-lg font-semibold">{lifecycle.answered}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">In Progress</div>
              <div className="text-lg font-semibold">{lifecycle.inProgress}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">Complete</div>
              <div className="text-lg font-semibold">{lifecycle.complete}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">Remaining</div>
              <div className="text-lg font-semibold">{lifecycle.remaining}</div>
            </div>
          </div>

          <div className="text-xs opacity-70 mt-3">
            Answered = any non-empty writing. Complete = you explicitly marked that week done.
          </div>
        </div>

        <div className="text-sm opacity-80">Current week: {currentWeek}</div>

        {message && <div className={cardClass}>{message}</div>}

        <div className={cardClass}>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-3">Week</th>
                  <th className="py-2 pr-3">Question</th>
                  <th className="py-2 pr-3">Email date</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Complete</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => {
                  const isFuture = r.week > currentWeek;
                  const rowClass = `${isFuture ? "opacity-60" : ""}`;

                  const disabled = !r.canToggle || busyWeek === r.week;
                  const toggleLabel = r.displayStatus === "Complete" ? "Unmark" : "Mark";

                  return (
                    <tr key={r.week} className={`border-b hover:bg-slate-50 ${rowClass}`}>
                      <td className="py-3 pr-3 cursor-pointer" onClick={() => goToWeek(r.week)}>
                        {r.week}
                      </td>

                      <td className="py-3 pr-3 cursor-pointer" onClick={() => goToWeek(r.week)}>
                        {r.title}
                      </td>

                      <td className="py-3 pr-3 cursor-pointer" onClick={() => goToWeek(r.week)}>
                        {r.scheduledText}
                      </td>

                      <td className={`py-3 pr-3 cursor-pointer ${statusClass(r.displayStatus)}`} onClick={() => goToWeek(r.week)}>
                        {r.displayStatus}
                      </td>

                      <td className="py-3">
                        {r.displayStatus === "Open" ? (
                          <button className={buttonClass} onClick={() => goToWeek(r.week)}>
                            Start
                          </button>
                        ) : (
                          <button className={buttonClass} disabled={disabled} onClick={() => toggleComplete(r.week)}>
                            {disabled ? "Saving..." : toggleLabel}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!startDate ? (
            <div className="text-sm opacity-80 mt-3">
              Your profile start date is not set yet, so email dates cannot be calculated.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}