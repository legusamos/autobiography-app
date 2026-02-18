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
  return normalizeEntryStatus(entry.status) === "complete"
    ? "Complete"
    : "In Progress";
}

export default function DashboardOverviewClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [currentWeek, setCurrentWeek] = useState<number>(1);
  const [busyWeek, setBusyWeek] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("start_date")
        .eq("id", auth.user.id)
        .single();

      const prof = profile as ProfileRow;
      setStartDate(prof?.start_date ?? null);

      if (prof?.start_date) {
        setCurrentWeek(weekFromStartDate(prof.start_date));
      }

      const { data: promptRows } = await supabase
        .from("prompts")
        .select("prompt_key, week, title")
        .eq("active", true)
        .order("week", { ascending: true });

      const { data: entryRows } = await supabase
        .from("entries")
        .select("id, week, content, status, updated_at")
        .eq("user_id", auth.user.id);

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

  const lifecycle = useMemo(() => {
    let openCount = 0;
    let inProgressCount = 0;
    let completeCount = 0;

    for (let w = 1; w <= 52; w++) {
      const e = entryByWeek.get(w);
      const status = deriveDisplayStatus(e);

      if (status === "Open") openCount += 1;
      if (status === "In Progress") inProgressCount += 1;
      if (status === "Complete") completeCount += 1;
    }

    return { openCount, inProgressCount, completeCount };
  }, [entryByWeek]);

  const progressPct = useMemo(() => {
    return Math.round((lifecycle.completeCount / 52) * 100);
  }, [lifecycle.completeCount]);

  const startEndDates = useMemo(() => {
    if (!startDate) return { startText: "-", endText: "-" };
    const start = new Date(startDate + "T00:00:00Z");
    const projectedEnd = addDays(start, 51 * 7);
    return {
      startText: formatDateShort(start),
      endText: formatDateShort(projectedEnd)
    };
  }, [startDate]);

  const rowLists = useMemo(() => {
    const base = startDate ? new Date(startDate + "T00:00:00Z") : null;

    const all = prompts
      .map((p) => {
        const e = entryByWeek.get(p.week);
        const displayStatus = deriveDisplayStatus(e);
        const scheduled = base
          ? addDays(base, (p.week - 1) * 7)
          : null;

        return {
          week: p.week,
          title: p.title,
          scheduledText: scheduled ? formatDateShort(scheduled) : "-",
          displayStatus,
          entry: e
        };
      })
      .sort((a, b) => a.week - b.week);

    const complete = all.filter((r) => r.displayStatus === "Complete");
    const inProgress = all.filter((r) => r.displayStatus === "In Progress");
    const open = all.filter((r) => r.displayStatus === "Open");

    return {
      complete,
      notComplete: [...inProgress, ...open]
    };
  }, [prompts, entryByWeek, startDate]);

  function goToWeek(week: number) {
    router.push(`/week?week=${week}`);
  }

  async function toggleComplete(week: number) {
    const e = entryByWeek.get(week);
    if (!e) return;

    const current = normalizeEntryStatus(e.status);
    const next: EntryStatusMode =
      current === "complete" ? "in_progress" : "complete";

    setBusyWeek(week);

    await supabase
      .from("entries")
      .update({ status: next })
      .eq("id", e.id);

    setEntries((prev) =>
      prev.map((row) =>
        row.id === e.id ? { ...row, status: next } : row
      )
    );

    setBusyWeek(null);
  }

  if (loading) return <div className="p-6">Loading dashboard...</div>;

  const cardClass = "border rounded-xl p-4";
  const miniButtonClass = "rounded border px-2 py-1 text-xs";
  const thClass = "py-1 px-2 text-xs";
  const tdClass = "py-1 px-2 text-sm";

  function rowStyle(status: DisplayStatus) {
    if (status === "Complete") {
      return "bg-green-100 text-black";
    }
    if (status === "In Progress") {
      return "bg-blue-100 text-black italic";
    }
    return "bg-white text-black";
  }

  function statusColor(status: DisplayStatus) {
    if (status === "Complete") return "text-green-800";
    if (status === "In Progress") return "text-blue-800";
    return "text-black";
  }

  function renderList(
    label: string,
    rows: Array<{
      week: number;
      title: string;
      scheduledText: string;
      displayStatus: DisplayStatus;
    }>
  ) {
    return (
      <div className={cardClass}>
        <div className="text-lg font-semibold mb-2">
          {label} ({rows.length})
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className={thClass}>Week</th>
                  <th className={thClass}>Question</th>
                  <th className={thClass}>Email</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.week}
                    className={`border-b ${rowStyle(
                      r.displayStatus
                    )}`}
                  >
                    <td
                      className={`${tdClass} cursor-pointer`}
                      onClick={() => goToWeek(r.week)}
                    >
                      {r.week}
                    </td>
                    <td
                      className={`${tdClass} cursor-pointer`}
                      onClick={() => goToWeek(r.week)}
                    >
                      {r.title}
                    </td>
                    <td
                      className={`${tdClass} cursor-pointer`}
                      onClick={() => goToWeek(r.week)}
                    >
                      {r.scheduledText}
                    </td>
                    <td
                      className={`${tdClass} ${statusColor(
                        r.displayStatus
                      )} cursor-pointer`}
                      onClick={() => goToWeek(r.week)}
                    >
                      {r.displayStatus}
                    </td>
                    <td className={tdClass}>
                      {r.displayStatus === "Open" ? (
                        <button
                          className={miniButtonClass}
                          onClick={() => goToWeek(r.week)}
                        >
                          Start
                        </button>
                      ) : (
                        <button
                          className={miniButtonClass}
                          disabled={busyWeek === r.week}
                          onClick={() =>
                            toggleComplete(r.week)
                          }
                        >
                          {busyWeek === r.week
                            ? "Saving..."
                            : r.displayStatus === "Complete"
                            ? "Unmark"
                            : "Mark"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="p-2 text-xs opacity-80">
                No items.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>

        <div className={cardClass}>
          <div className="flex justify-between">
            <div>
              Progress: {lifecycle.completeCount} of 52 complete
            </div>
            <div>{progressPct}%</div>
          </div>

          <div className="mt-3 w-full border rounded-lg h-4 overflow-hidden bg-white">
            <div
              className="h-4 bg-green-600 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex justify-between text-xs mt-2">
            <div>Start: {startEndDates.startText}</div>
            <div>Projected end: {startEndDates.endText}</div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="border rounded-lg p-3">
              <div className="text-xs">In Progress</div>
              <div className="text-lg font-semibold">
                {lifecycle.inProgressCount}
              </div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="text-xs">Complete</div>
              <div className="text-lg font-semibold">
                {lifecycle.completeCount}
              </div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="text-xs">Remaining Open</div>
              <div className="text-lg font-semibold">
                {lifecycle.openCount}
              </div>
            </div>
          </div>
        </div>

        {renderList("Complete", rowLists.complete)}
        {renderList("In Progress + Open", rowLists.notComplete)}
      </div>
    </div>
  );
}