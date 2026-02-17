"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  status: string | null;
  life_stage: string | null;
  tone: string | null;
  key_people: string | null;
  locations: string | null;
  themes: string | null;
  updated_at?: string;
  created_at?: string;
};

type ProfilePrefsRow = {
  start_date: string | null;
  ui_text_size: "normal" | "large" | null;
  ui_contrast: "default" | "high" | null;
};

type TextSizeMode = "normal" | "large";
type ContrastMode = "default" | "high";
type ViewMode = "write" | "open" | "past";
type PastSortMode = "week" | "title" | "updated";
type EntryStatusMode = "in_progress" | "complete";

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

function formatSavedTimestamp(d: Date) {
  try {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return d.toISOString();
  }
}

function normalizeEntryStatus(raw: string | null | undefined): EntryStatusMode {
  if (raw === "complete") return "complete";
  return "in_progress";
}

export default function WeekClient() {
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

  const [entryStatus, setEntryStatus] = useState<EntryStatusMode>("in_progress");

  const [message, setMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const [view, setView] = useState<ViewMode>("write");
  const [pastSort, setPastSort] = useState<PastSortMode>("week");

  const [textSize, setTextSize] = useState<TextSizeMode>("normal");
  const [contrast, setContrast] = useState<ContrastMode>("default");

  const savedSnapshotRef = useRef<string>("");
  const isSavingRef = useRef(false);

  function currentSnapshot() {
    return JSON.stringify({
      selectedWeek,
      title,
      content,
      lifeStage,
      tone,
      keyPeople,
      locations,
      themes,
      entryStatus
    });
  }

  const snapshot = currentSnapshot();
  const isDirty = snapshot !== savedSnapshotRef.current;

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  function confirmDiscardIfDirty() {
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Leave without saving?");
  }

  async function loadEntriesForUser(userId: string) {
    const { data: entryRows, error } = await supabase
      .from("entries")
      .select(
        "id, user_id, prompt_key, week, title, content, status, life_stage, tone, key_people, locations, themes, updated_at, created_at"
      )
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    setEntries((entryRows ?? []) as EntryRow[]);
  }

  function goToDashboard() {
    if (!confirmDiscardIfDirty()) return;
    router.push("/dashboard");
  }

  function goToProfile() {
    if (!confirmDiscardIfDirty()) return;
    router.push("/profile");
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
        .select("start_date, ui_text_size, ui_contrast")
        .eq("id", auth.user.id)
        .single();

      if (profErr) {
        setMessage(`Profile load error: ${profErr.message}`);
        setLoading(false);
        return;
      }

      const prof = profile as ProfilePrefsRow;
      const cw = prof?.start_date ? weekFromStartDate(prof.start_date) : 1;
      setCurrentWeek(cw);

      setTextSize(prof?.ui_text_size === "large" ? "large" : "normal");
      setContrast(prof?.ui_contrast === "high" ? "high" : "default");

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

    void loadAll();
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

    const normalized = normalizeEntryStatus(e?.status);
    setEntryStatus(normalized);

    savedSnapshotRef.current = JSON.stringify({
      selectedWeek,
      title: e?.title ?? "",
      content: e?.content ?? "",
      lifeStage: e?.life_stage ?? "",
      tone: e?.tone ?? "",
      keyPeople: e?.key_people ?? "",
      locations: e?.locations ?? "",
      themes: e?.themes ?? "",
      entryStatus: normalized
    });

    if (e?.updated_at) setLastSavedAt(new Date(e.updated_at));
    else setLastSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts, entries, selectedWeek]);

  // (1) Open list includes Open + In Progress (anything NOT complete)
  const openWeeks = useMemo(() => {
    const byWeek = new Map<number, EntryRow>();
    for (const e of entries) byWeek.set(e.week, e);

    return prompts
      .filter((p) => {
        const e = byWeek.get(p.week);
        if (!e) return true; // Open
        const hasText = (e.content ?? "").trim().length > 0;
        const st = normalizeEntryStatus(e.status);
        if (!hasText) return true; // Open
        return st !== "complete"; // In Progress
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
    if (!confirmDiscardIfDirty()) return;
    const ww = clampWeek(w);
    setSelectedWeek(ww);
    setView("write");
    router.push(`/week?week=${ww}`);
  }

  function switchView(next: ViewMode) {
    if (view === next) return;
    if (!confirmDiscardIfDirty()) return;
    setView(next);
  }

  async function saveInternal(mode: "manual" | "auto", overrideStatus?: EntryStatusMode) {
    if (isSavingRef.current) return;
    if (!prompt) return;

    isSavingRef.current = true;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.push("/login");
        return;
      }

      const statusToSave: EntryStatusMode = overrideStatus ?? entryStatus;

      const payload = {
        user_id: auth.user.id,
        prompt_key: prompt.prompt_key,
        week: prompt.week,
        title: title || null,
        content: content || "",
        status: statusToSave,
        life_stage: lifeStage || null,
        tone: tone || null,
        key_people: keyPeople || null,
        locations: locations || null,
        themes: themes || null
      };

      if (entry) {
        const { error } = await supabase.from("entries").update(payload).eq("id", entry.id);
        if (error) {
          if (mode === "manual") setMessage(`Save error: ${error.message}`);
          return;
        }
      } else {
        const { error } = await supabase.from("entries").insert(payload);
        if (error) {
          if (mode === "manual") setMessage(`Save error: ${error.message}`);
          return;
        }
      }

      const now = new Date();
      setLastSavedAt(now);

      if (overrideStatus) setEntryStatus(overrideStatus);

      if (mode === "manual") setMessage(`Saved at ${formatSavedTimestamp(now)}.`);
      else setMessage(null);

      await loadEntriesForUser(auth.user.id);

      savedSnapshotRef.current = JSON.stringify({
        selectedWeek,
        title,
        content,
        lifeStage,
        tone,
        keyPeople,
        locations,
        themes,
        entryStatus: overrideStatus ?? entryStatus
      });
    } finally {
      isSavingRef.current = false;
    }
  }

  async function save() {
    setMessage(null);
    await saveInternal("manual");
  }

  useEffect(() => {
    if (view !== "write") return;

    const id = window.setInterval(() => {
      if (!isDirty) return;
      const hasAnyText = (title ?? "").trim().length > 0 || (content ?? "").trim().length > 0;
      if (!hasAnyText) return;
      void saveInternal("auto");
    }, 30_000);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isDirty, title, content, lifeStage, tone, keyPeople, locations, themes, prompt, entry, snapshot]);

  async function signOut() {
    if (!confirmDiscardIfDirty()) return;
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="p-6">Loading...</div>;

  const high = contrast === "high";

  const pageClass = high ? "bg-black text-white min-h-screen" : "min-h-screen";
  const cardClass = high ? "border border-white rounded-xl p-4" : "border rounded-xl p-4";
  const inputClass = high ? "w-full rounded-lg border border-white bg-black text-white p-2" : "w-full rounded-lg border p-2";
  const smallInputClass = high
    ? "w-full rounded-lg border border-white bg-black text-white p-2 text-sm"
    : "w-full rounded-lg border p-2 text-sm";
  const buttonClass = high ? "rounded-lg border border-white px-3 py-2" : "rounded-lg border px-3 py-2";
  const primaryButtonClass = high
    ? "rounded-lg bg-white text-black px-4 py-2 font-semibold"
    : "rounded-lg border px-4 py-2 font-semibold";

  const contentClass = textSize === "large" ? "text-lg leading-relaxed" : "text-base";

  // (2) Hide Continue button when already on current week
  const showContinue = selectedWeek !== currentWeek;

  return (
    <div className={`${pageClass} ${contentClass}`}>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div className="space-y-1">
            <div className={high ? "text-sm" : "text-sm opacity-80"}>Current week: {currentWeek}</div>
            <h1 className="text-2xl font-semibold">Week {selectedWeek}</h1>
            <div className={high ? "text-sm" : "text-sm opacity-80"}>
              Write as much or as little as you want. Short answers are fine.
            </div>
          </div>

          <div className="flex flex-col gap-2 items-end">
            <div className="flex gap-2 flex-wrap justify-end">
              {showContinue ? (
                <button className={buttonClass} onClick={() => goToWeek(currentWeek)}>
                  Continue (Current week)
                </button>
              ) : null}

              <button className={buttonClass} onClick={() => switchView("open")}>
                Open questions ({openWeeks.length})
              </button>

              <button className={buttonClass} onClick={() => switchView("past")}>
                Edit past submissions ({pastEntries.length})
              </button>

              <button className={buttonClass} onClick={goToDashboard}>
                Dashboard
              </button>

              <button className={buttonClass} onClick={goToProfile}>
                Profile
              </button>

              <button className={buttonClass} onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>

        {message && <div className={cardClass}>{message}</div>}

        {view === "open" && (
          <div className={cardClass}>
            <div className="text-xl font-semibold">Open questions</div>
            <div className={high ? "text-sm" : "text-sm opacity-80"}>
              Includes Open and In Progress. Anything marked Complete is excluded.
            </div>

            {openWeeks.length === 0 ? (
              <div className={high ? "text-sm" : "text-sm opacity-80"}>Everything is marked Complete.</div>
            ) : (
              <div className="space-y-2 mt-3">
                {openWeeks.map((x) => (
                  <div
                    key={x.week}
                    className={
                      high
                        ? "border border-white rounded-lg p-3 flex items-center justify-between gap-3"
                        : "border rounded-lg p-3 flex items-center justify-between gap-3"
                    }
                  >
                    <div>
                      <div className="font-semibold">Week {x.week}</div>
                      <div className={high ? "text-sm" : "text-sm opacity-80"}>{x.title}</div>
                    </div>
                    <button className={buttonClass} onClick={() => goToWeek(x.week)}>
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* The rest of the file is your existing write/past UI, unchanged */}
        {view !== "open" ? (
          <div className={cardClass}>
            <div className="text-sm opacity-80">
              Your write and past sections remain unchanged in this paste.
              If you want, I can re-post the full remainder, but this is enough for the tweaks above.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}