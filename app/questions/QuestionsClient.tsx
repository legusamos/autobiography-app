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
  updated_at?: string;
};

type ProfileRow = {
  start_date: string | null;
  ui_text_size: "normal" | "large" | null;
  ui_contrast: "default" | "high" | null;
};

function clampWeek(n: number) {
  if (!Number.isFinite(n)) return 1;
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
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
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

      setStartDate(prof.start_date ?? null);
      setTextSize(prof.ui_text_size === "large" ? "large" : "normal");
      setContrast(prof.ui_contrast === "high" ? "high" : "default");

      const cw = prof.start_date ? weekFromStartDate(prof.start_date) : 1;
      setCurrentWeek(cw);

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
        .select("id, week, content, updated_at")
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

  const rows = useMemo(() => {
    const base = startDate ? new Date(startDate + "T00:00:00Z") : null;

    return prompts.map((p) => {
      const e = entryByWeek.get(p.week);
      const answered = !!e && (e.content ?? "").trim().length > 0;

      const scheduled = base ? addDays(base, (p.week - 1) * 7) : null;

      return {
        week: p.week,
        title: p.title,
        scheduledText: scheduled ? formatDateShort(scheduled) : "Set start date",
        answered
      };
    });
  }, [prompts, entryByWeek, startDate]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function goToWeek(week: number) {
    router.push(`/dashboard?week=${week}`);
  }

  function goToCurrentWeek() {
    router.push(`/dashboard?week=${currentWeek}`);
  }

  if (loading) return <div className="p-6">Loading questions...</div>;

  const high = contrast === "high";
  const pageClass = high ? "bg-black text-white min-h-screen" : "min-h-screen";
  const cardClass = high ? "border border-white rounded-xl p-4" : "border rounded-xl p-4";
  const buttonClass = high ? "rounded-lg border border-white px-3 py-2" : "rounded-lg border px-3 py-2";
  const contentClass = textSize === "large" ? "text-lg leading-relaxed" : "text-base";

  return (
    <div className={`${pageClass} ${contentClass}`}>
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
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
            <button className={buttonClass} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {message && <div className={cardClass}>{message}</div>}

        <div className={cardClass}>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className={high ? "border-b border-white" : "border-b"}>
                  <th className="py-2 pr-3">Week</th>
                  <th className="py-2 pr-3">Question</th>
                  <th className="py-2 pr-3">Email date</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isCurrent = r.week === currentWeek;

                  return (
                    <tr
                      key={r.week}
                      className={
                        high
                          ? `border-b border-white cursor-pointer hover:opacity-90 ${isCurrent ? "font-semibold" : ""}`
                          : `border-b cursor-pointer hover:bg-slate-50 ${isCurrent ? "font-semibold" : ""}`
                      }
                      onClick={() => goToWeek(r.week)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") goToWeek(r.week);
                      }}
                    >
                      <td className="py-3 pr-3">{r.week}</td>
                      <td className="py-3 pr-3">{r.title}</td>
                      <td className="py-3 pr-3">{r.scheduledText}</td>
                      <td className="py-3">{r.answered ? "Answered" : "Open"}</td>
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