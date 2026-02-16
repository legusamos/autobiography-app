"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter, useSearchParams } from "next/navigation";

type PromptRow = {
  prompt_key: string;
  week: number;
  title: string;
  category: string;
  coaching: string;
  questions: string[];
  helpful_followups: string[];
};

type EntryRow = {
  id: string;
  user_id: string;
  prompt_key: string;
  week: number;
  title: string | null;
  content: string;
  status: string;
  updated_at?: string;
  created_at?: string;
};

type ProfileRow = {
  start_date: string | null;
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

export default function DashboardClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const weekParam = useMemo(() => {
    const w = sp.get("week");
    if (!w) return null;
    return clampWeek(Number(w));
  }, [sp]);

  const [loading, setLoading] = useState(true);

  const [currentWeek, setCurrentWeek] = useState<number>(1);
  const [selectedWeek, setSelectedWeek] = useState<number>(1);

  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);

  const [prompt, setPrompt] = useState<PromptRow | null>(null);
  const [entry, setEntry] = useState<EntryRow | null>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const [view, setView] = useState<"write" | "open" | "past">("write");
  const [pastSort, setPastSort] = useState<"week" | "title" | "updated">("week");

  useEffect(() => {
    async function loadAll() {
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
      const cw = prof.start_date ? weekFromStartDate(prof.start_date) : 1;
      setCurrentWeek(cw);

      const initialWeek = weekParam ?? cw;
      setSelectedWeek(initialWeek);

      const { data: promptRows, error: promptErr } = await supabase
        .from("prompts")
        .select("prompt_key, week, title, category, coaching, questions, helpful_followups")
        .eq("active", true)
        .order("week", { ascending: true });

      if (promptErr) {
        setMessage(`Prompt list error: ${promptErr.message}`);
        setLoading(false);
        return;
      }

      setPrompts((promptRows ?? []) as PromptRow[]);

      const { data: entryRows, error: entryErr } = await supabase
        .from("entries")
        .select("id, user_id, prompt_key, week, title, content, status, updated_at, created_at")
        .eq("user_id", auth.user.id);

      if (entryErr) {
        setMessage(`Entry list error: ${entryErr.message}`);
        setLoading(false);
        return;
      }

      setEntries((entryRows ?? []) as EntryRow[]);
      setLoading(false);
    }

    loadAll();
  }, [router, weekParam]);

  useEffect(() => {
    // When selectedWeek changes, load the prompt and entry from in-memory lists
    const p = prompts.find((x) => x.week === selectedWeek) ?? null;
    setPrompt(p);

    const e = entries.find((x) => x.week === selectedWeek) ?? null;
    setEntry(e);

    setTitle(e?.title ?? "");
    setContent(e?.content ?? "");
  }, [prompts, entries, selectedWeek]);

  const openWeeks = useMemo(() => {
    // Prompt exists but no entry, or entry content is blank
    const byWeek = new Map<number, EntryRow>();
    for (const e of entries) byWeek.set(e.week, e);

    return prompts
      .filter((p) => {
        const e = byWeek.get(p.week);
        if (!e) return true;
        return (e.content ?? "").trim().length === 0;
      })
      .map((p) => ({
        week: p.week,
        title: p.title,
        prompt_key: p.prompt_key
      }));
  }, [prompts, entries]);

  const pastEntries = useMemo(() => {
    const promptByWeek = new Map<number, PromptRow>();
    for (const p of prompts) promptByWeek.set(p.week, p);

    const filled = entries
      .filter((e) => (e.content ?? "").trim().length > 0)
      .map((e) => {
        const p = promptByWeek.get(e.week);
        return {
          week: e.week,
          promptTitle: p?.title ?? `Week ${e.week}`,
          entryTitle: e.title ?? "",
          updated_at: e.updated_at ?? "",
          id: e.id
        };
      });

    const sorted = [...filled];
    if (pastSort === "week") {
      sorted.sort((a, b) => a.week - b.week);
    } else if (pastSort === "title") {
      sorted.sort((a, b) => a.promptTitle.localeCompare(b.promptTitle));
    } else {
      sorted.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    }
    return sorted;
  }, [entries, prompts, pastSort]);

  function goToWeek(w: number) {
    const ww = clampWeek(w);
    setSelectedWeek(ww);
    setView("write");
    router.push(`/dashboard?week=${ww}`);
  }

  async function save() {
    setMessage(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.push("/login");
      return;
    }
    if (!prompt) return;

    const payload = {
      user_id: auth.user.id,
      prompt_key: prompt.prompt_key,
      week: prompt.week,
      title: title || null,
      content: content || "",
      status: "draft"
    };

    if (entry) {
      const { error } = await supabase.from("entries").update(payload).eq("id", entry.id);
      if (error) setMessage(`Save error: ${error.message}`);
      else setMessage("Saved.");
    } else {
      const { data, error } = await supabase.from("entries").insert(payload).select().single();
      if (error) setMessage(`Save error: ${error.message}`);
      else {
        setMessage("Saved.");
        // Refresh the entry list locally by appending
        setEntries((prev) => [...prev, data as EntryRow]);
      }
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <div className="text-sm opacity-80">Current week: {currentWeek}</div>
          <h1 className="text-2xl font-semibold">Week {selectedWeek}</h1>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button className="rounded-lg border px-3 py-2" onClick={() => goToWeek(currentWeek)}>
            Continue (Current week)
          </button>
          <button className="rounded-lg border px-3 py-2" onClick={() => setView("open")}>
            Open questions ({openWeeks.length})
          </button>
          <button className="rounded-lg border px-3 py-2" onClick={() => setView("past")}>
            Edit past submissions ({pastEntries.length})
          </button>
          <button className="rounded-lg border px-3 py-2" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {message && <div className="rounded-lg border p-3 text-sm">{message}</div>}

      {view === "open" && (
        <div className="rounded-xl border p-4 space-y-3">
          <div className="text-xl font-semibold">Open questions</div>
          {openWeeks.length === 0 ? (
            <div className="text-sm opacity-80">You are caught up.</div>
          ) : (
            <div className="space-y-2">
              {openWeeks.map((x) => (
                <div key={x.week} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                  <div>
                    <div className="font-semibold">Week {x.week}</div>
                    <div className="text-sm opacity-80">{x.title}</div>
                  </div>
                  <button className="rounded-lg border px-3 py-2" onClick={() => goToWeek(x.week)}>
                    Start
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "past" && (
        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xl font-semibold">Edit past submissions</div>
            <div className="flex gap-2 flex-wrap">
              <button
                className={`rounded-lg border px-3 py-2 ${pastSort === "week" ? "font-semibold" : ""}`}
                onClick={() => setPastSort("week")}
              >
                Sort by week
              </button>
              <button
                className={`rounded-lg border px-3 py-2 ${pastSort === "title" ? "font-semibold" : ""}`}
                onClick={() => setPastSort("title")}
              >
                Sort by question
              </button>
              <button
                className={`rounded-lg border px-3 py-2 ${pastSort === "updated" ? "font-semibold" : ""}`}
                onClick={() => setPastSort("updated")}
              >
                Sort by last edit
              </button>
            </div>
          </div>

          {pastEntries.length === 0 ? (
            <div className="text-sm opacity-80">No completed entries yet.</div>
          ) : (
            <div className="space-y-2">
              {pastEntries.map((x) => (
                <div key={x.id} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                  <div>
                    <div className="font-semibold">Week {x.week}</div>
                    <div className="text-sm opacity-80">{x.promptTitle}</div>
                    {x.entryTitle ? <div className="text-sm">Entry title: {x.entryTitle}</div> : null}
                  </div>
                  <button className="rounded-lg border px-3 py-2" onClick={() => goToWeek(x.week)}>
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "write" && (
        <>
          {prompt ? (
            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm opacity-80">{prompt.category}</div>
              <div className="text-xl font-semibold">{prompt.title}</div>
              <div className="text-sm">{prompt.coaching}</div>

              <div className="space-y-2">
                <div className="font-semibold">Main questions</div>
                <ul className="list-disc pl-6 space-y-1">
                  {prompt.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <div className="font-semibold">Helpful follow ups</div>
                <ul className="list-disc pl-6 space-y-1">
                  {prompt.helpful_followups.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border p-4">No prompt found for Week {selectedWeek}.</div>
          )}

          <div className="rounded-xl border p-4 space-y-3">
            <div className="font-semibold">Your entry</div>

            <input
              className="w-full rounded-lg border p-2"
              placeholder="Optional title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <textarea
              className="w-full rounded-lg border p-2 min-h-[260px]"
              placeholder="Write here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />

            <div className="flex items-center gap-3">
              <button className="rounded-lg border px-4 py-2 font-semibold" onClick={save}>
                Save
              </button>
              {entry ? <span className="text-sm opacity-80">Editing saved entry</span> : <span className="text-sm opacity-80">New entry</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
