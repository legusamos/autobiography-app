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
  life_stage: string | null;
  tone: string | null;
  key_people: string | null;
  locations: string | null;
  themes: string | null;
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

  const [lifeStage, setLifeStage] = useState("");
  const [tone, setTone] = useState("");
  const [keyPeople, setKeyPeople] = useState("");
  const [locations, setLocations] = useState("");
  const [themes, setThemes] = useState("");

  const [message, setMessage] = useState<string | null>(null);

  const [view, setView] = useState<"write" | "open" | "past">("write");
  const [pastSort, setPastSort] = useState<"week" | "title" | "updated">("week");

  async function loadEntriesForUser(userId: string) {
    const { data: entryRows, error } = await supabase
      .from("entries")
      .select("id, user_id, prompt_key, week, title, content, status, life_stage, tone, key_people, locations, themes, updated_at, created_at")
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    setEntries((entryRows ?? []) as EntryRow[]);
  }

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
      const cw = prof?.start_date ? weekFromStartDate(prof.start_date) : 1;
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

      try {
        await loadEntriesForUser(auth.user.id);
      } catch (e: any) {
        setMessage(`Entry list error: ${e.message}`);
        setLoading(false);
        return;
      }

      setLoading(false);
    }

    loadAll();
  }, [router, weekParam]);

  useEffect(() => {
    const p = prompts.find((x) => x.week === selectedWeek) ?? null;
    setPrompt(p);

    const e = entries.find((x) => x.week === selectedWeek) ?? null;
    setEntry(e);

    setTitle(e?.title ?? "");
    setContent(e?.content ?? "");

    setLifeStage(e?.life_stage ?? "");
    setTone(e?.tone ?? "");
    setKeyPeople(e?.key_people ?? "");
    setLocations(e?.locations ?? "");
    setThemes(e?.themes ?? "");
  }, [prompts, entries, selectedWeek]);

  const openWeeks = useMemo(() => {
    const byWeek = new Map<number, EntryRow>();
    for (const e of entries) byWeek.set(e.week, e);

    return prompts
      .filter((p) => {
        const e = byWeek.get(p.week);
        if (!e) return true;
        return (e.content ?? "").trim().length === 0;
      })
      .map((p) => ({ week: p.week, title: p.title }));
  }, [prompts, entries]);

  const pastEntries = useMemo(() => {
    const promptByWeek = new Map<number, PromptRow>();
    for (const p of prompts) promptByWeek.set(p.week, p);

    const filled = entries
      .filter((e) => (e.content ?? "").trim().length > 0)
      .map((e) => {
        const p = promptByWeek.get(e.week);
        return {
          id: e.id,
          week: e.week,
          promptTitle: p?.title ?? `Week ${e.week}`,
          entryTitle: e.title ?? "",
          updated_at: e.updated_at ?? ""
        };
      });

    const sorted = [...filled];
    if (pastSort === "week") sorted.sort((a, b) => a.week - b.week);
    if (pastSort === "title") sorted.sort((a, b) => a.promptTitle.localeCompare(b.promptTitle));
    if (pastSort === "updated") sorted.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
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
      status: "draft",
      life_stage: lifeStage || null,
      tone: tone || null,
      key_people: keyPeople || null,
      locations: locations || null,
      themes: themes || null
    };

    if (entry) {
      const { error } = await supabase.from("entries").update(payload).eq("id", entry.id);
      if (error) {
        setMessage(`Save error: ${error.message}`);
        return;
      }
      setMessage("Saved.");
    } else {
      const { error } = await supabase.from("entries").insert(payload);
      if (error) {
        setMessage(`Save error: ${error.message}`);
        return;
      }
      setMessage("Saved.");
    }

    // Refresh entries so Open/Past lists update immediately
    await loadEntriesForUser(auth.user.id);
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm">Life stage</label>
                <select
                  className="w-full rounded-lg border p-2"
                  value={lifeStage}
                  onChange={(e) => setLifeStage(e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="Early childhood">Early childhood</option>
                  <option value="School years">School years</option>
                  <option value="Young adult">Young adult</option>
                  <option value="Early career">Early career</option>
                  <option value="Midlife">Midlife</option>
                  <option value="Later life">Later life</option>
                  <option value="Reflection">Reflection</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm">Emotional tone</label>
                <select className="w-full rounded-lg border p-2" value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="">Select</option>
                  <option value="Joyful">Joyful</option>
                  <option value="Grateful">Grateful</option>
                  <option value="Proud">Proud</option>
                  <option value="Hopeful">Hopeful</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Bittersweet">Bittersweet</option>
                  <option value="Sad">Sad</option>
                  <option value="Angry">Angry</option>
                  <option value="Anxious">Anxious</option>
                  <option value="Regretful">Regretful</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm">Key people (comma-separated)</label>
              <input
                className="w-full rounded-lg border p-2"
                placeholder="Example: Mom, Grandpa Ed, Coach Thompson"
                value={keyPeople}
                onChange={(e) => setKeyPeople(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm">Locations (comma-separated)</label>
              <input
                className="w-full rounded-lg border p-2"
                placeholder="Example: Dayton, Ohio; Myrtle Beach; Fort Benning"
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm">Themes (comma-separated)</label>
              <input
                className="w-full rounded-lg border p-2"
                placeholder="Example: resilience, family, faith, work ethic"
                value={themes}
                onChange={(e) => setThemes(e.target.value)}
              />
            </div>

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
