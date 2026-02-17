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
  status: string | null; // "draft"(legacy), "in_progress", "complete"
  updated_at?: string;
};

type ProfileRow = {
  start_date: string | null;
  ui_text_size: "normal" | "large" | null;
  ui_contrast: "default" | "high" | null;
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
  // Backward compatible: treat anything non-"complete" as "in_progress"
  if (raw === "complete") return "complete";
  return "in_progress";
}

function deriveDisplayStatus(entry: EntryRow | undefined): DisplayStatus {
  if (!entry) return "Open";
  const hasText = (entry.content ?? "").trim().length > 0;
  if (!hasText) return "Open";
  return normalizeEntryStatus(entry.status) === "complete" ? "Complete" : "In Progress";
}

export default function QuestionsClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [currentWeek, setCurrentWeek] = useState<number>(1);

  const [textSize, setTextSize] = useState<"normal" | "large">("normal");
  const [contrast, setContrast] = useState<"default" | "high">("default");

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
        .select("start_date, ui_text_size, ui_contrast")
        .eq("id", auth.user.id)
        .single();

      if (profErr) {
        setMessage(`Profile load error: ${profErr.message}`);
        setLoading(false);
        return;
      }

      const prof = profile as ProfileRow;

      setStartDate(prof?.start_date ?? null);
      setTextSize(prof?.ui_text_size === "large" ? "large" : "normal");
      setContrast(prof?.ui_contrast === "high" ? "high" : "default");

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

  // Completion = all 52 weeks are explicitly COMPLETE and have non-empty content
  const allCompleted = useMemo(() => {
    if (prompts.length !== 52) return false;
    return prompts.every((p) => {
      const e = entryByWeek.get(p.week);
      if (!e) return false;
      const hasText = (e.content ?? "").trim().length > 0;
      if (!hasText) return false;
      return normalizeEntryStatus(e.status) === "complete";
    });
  }, [prompts, entryByWeek]);

  const rows = useMemo(() => {
    const base = startDate ? new Date(startDate + "T00:00:00Z") : null;

    return prompts.map((p) => {
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
  }, [prompts, entryByWeek, startDate]);

  function goToWeek(week: number) {
    router.push(`/dashboard?week=${week}`);
  }

  function goToCurrentWeek() {
    router.push(`/dashboard?week=${currentWeek}`);
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

  if (loading) return <div className="p-6">Loading questions...</div>;

  const high = contrast === "high";
  const pageClass = high ? "bg-black text-white min-h-screen" : "min-h-screen";
  const contentClass = textSize === "large" ? "text-lg leading-relaxed" : "text-base";

  const cardClass = high ? "border border-white rounded-xl p-4" : "border rounded-xl p-4";
  const buttonClass = high ? "rounded-lg border border-white px-3 py-2" : "rounded-lg border px-3 py-2";

  const theadBorderClass = high ? "border-b border-white" : "border-b";
  const rowBorderClass = high ? "border-b border-white" : "border-b";

  function statusClass(status: DisplayStatus) {
    if (high) {
      // High contrast: readable, no colored backgrounds
      if (status === "Complete") return "font-semibold";
      if (status === "In Progress") return "opacity-90";
      return "opacity-70";
    }
    if (status === "Complete") return "text-green-700 font-semibold";
    if (status === "In Progress") return "text-blue-700 font-medium";
    return "text-gray-600";
  }

  return (
    <div className={`${pageClass} ${contentClass}`}>
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">All Questions</h1>
            <div className={high ? "text-sm" : "text-sm opacity-80"}>
              Work ahead or pick any question that feels right today. Weekly emails stay on schedule.
            </div>
            <div className={high ? "text-sm" : "text-sm opacity-80"}>Current week: {currentWeek}</div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button className={buttonClass} onClick={goToCurrentWeek}>
              Go to current week
            </button>
            <button className={buttonClass} onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </button>
            <button className={buttonClass} onClick={() => router.push("/profile")}>
              Profile
            </button>
            <button className={buttonClass} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {message && <div className={cardClass}>{message}</div>}

        {allCompleted ? (
          <div className={cardClass}>
            <div className="font-semibold">Congratulations.</div>
            <div className={high ? "text-sm" : "text-sm opacity-80"}>You have completed all 52 questions.</div>
          </div>
        ) : null}

        <div className={cardClass}>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className={theadBorderClass}>
                  <th className="py-2 pr-3">Week</th>
                  <th className="py-2 pr-3">Question</th>
                  <th className="py-2 pr-3">Email date</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Complete</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => {
                  const isCurrent = r.week === currentWeek;
                  const isFuture = r.week > currentWeek;

                  const currentRowClass = high
                    ? "outline outline-2 outline-white outline-offset-[-2px] font-semibold"
                    : "bg-slate-100 font-semibold";

                  const futureClass = isFuture ? "opacity-60" : "";
                  const hoverClass = high ? "hover:opacity-90" : "hover:bg-slate-50";

                  const disabled = !r.canToggle || busyWeek === r.week;

                  const toggleLabel = r.displayStatus === "Complete" ? "Unmark" : "Mark";

                  return (
                    <tr
                      key={r.week}
                      className={`${rowBorderClass} ${hoverClass} ${futureClass} ${isCurrent ? currentRowClass : ""}`}
                    >
                      <td
                        className="py-3 pr-3 cursor-pointer"
                        onClick={() => goToWeek(r.week)}
                        role="button"
                        tabIndex={0}
                      >
                        {r.week}
                      </td>

                      <td
                        className="py-3 pr-3 cursor-pointer"
                        onClick={() => goToWeek(r.week)}
                        role="button"
                        tabIndex={0}
                      >
                        {r.title}
                      </td>

                      <td
                        className="py-3 pr-3 cursor-pointer"
                        onClick={() => goToWeek(r.week)}
                        role="button"
                        tabIndex={0}
                      >
                        {r.scheduledText}
                      </td>

                      <td
                        className={`py-3 pr-3 cursor-pointer ${statusClass(r.displayStatus)}`}
                        onClick={() => goToWeek(r.week)}
                        role="button"
                        tabIndex={0}
                      >
                        {r.displayStatus}
                      </td>

                      <td className="py-3">
                        {r.displayStatus === "Open" ? (
                          <button className={buttonClass} onClick={() => goToWeek(r.week)}>
                            Start
                          </button>
                        ) : (
                          <button
                            className={buttonClass}
                            disabled={disabled}
                            onClick={() => toggleComplete(r.week)}
                            title={r.displayStatus === "Complete" ? "Mark as in progress" : "Mark as complete"}
                          >
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
            <div className={high ? "text-sm mt-3" : "text-sm opacity-80 mt-3"}>
              Your profile start date is not set yet, so email dates cannot be calculated.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}