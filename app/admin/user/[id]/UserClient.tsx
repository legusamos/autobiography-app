"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useParams, useRouter } from "next/navigation";

type ProfileRow = {
  id: string;
  email: string | null;
  role: string;
  start_date: string | null;
  created_at: string;
};

type PromptRow = {
  week: number;
  title: string;
};

type EntryRow = {
  id: string;
  week: number;
  title: string | null;
  content: string;
  life_stage: string | null;
  tone: string | null;
  key_people: string | null;
  locations: string | null;
  themes: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export default function UserClient() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<ProfileRow | null>(null);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);

  const promptTitleByWeek = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of prompts) m.set(p.week, p.title);
    return m;
  }, [prompts]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.push(`/login?next=${encodeURIComponent(`/admin/user/${userId ?? ""}`)}`);
        return;
      }

      const { data: me, error: meErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

      if (meErr) {
        setError(meErr.message);
        setLoading(false);
        return;
      }

      if ((me as any)?.role !== "admin") {
        setError("Not authorized.");
        setLoading(false);
        return;
      }

      if (!userId) {
        setError("Missing user id.");
        setLoading(false);
        return;
      }

      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, role, start_date, created_at")
        .eq("id", userId)
        .single();

      if (pErr) {
        setError(pErr.message);
        setLoading(false);
        return;
      }

      setTarget(prof as ProfileRow);

      const { data: pr, error: prErr } = await supabase
        .from("prompts")
        .select("week, title")
        .eq("active", true)
        .order("week", { ascending: true });

      if (prErr) {
        setError(prErr.message);
        setLoading(false);
        return;
      }

      setPrompts((pr ?? []) as PromptRow[]);

      const { data: er, error: eErr } = await supabase
        .from("entries")
        .select("id, week, title, content, life_stage, tone, key_people, locations, themes, updated_at, created_at")
        .eq("user_id", userId)
        .order("week", { ascending: true });

      if (eErr) {
        setError(eErr.message);
        setLoading(false);
        return;
      }

      setEntries((er ?? []) as EntryRow[]);
      setLoading(false);
    }

    load();
  }, [router, userId]);

  function exportJson() {
    if (!target) return;

    const payload = {
      exported_at: new Date().toISOString(),
      user: {
        id: target.id,
        email: target.email,
        role: target.role
      },
      entries: entries.map((e) => ({
        week: e.week,
        prompt_title: promptTitleByWeek.get(e.week) ?? `Week ${e.week}`,
        entry_title: e.title ?? null,
        content: e.content ?? "",

        life_stage: e.life_stage ?? null,
        tone: e.tone ?? null,
        key_people: e.key_people ?? null,
        locations: e.locations ?? null,
        themes: e.themes ?? null,

        updated_at: e.updated_at ?? null,
        created_at: e.created_at ?? null
      }))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const safeEmail = (target.email ?? userId ?? "user").replaceAll("/", "_");
    const date = new Date().toISOString().slice(0, 10);

    const a = document.createElement("a");
    a.href = url;
    a.download = `autobiography_${safeEmail}_${date}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-6">Loading user...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">User</h1>
          {target ? (
            <div className="text-sm opacity-80">
              {target.email ?? "(no email)"} · Started: {target.start_date ?? "-"} · Entries:{" "}
              {entries.length}
            </div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg border px-3 py-2" onClick={() => router.push("/admin")}>
            Back to Admin
          </button>
          <button className="rounded-lg border px-3 py-2" onClick={exportJson} disabled={!target}>
            Export JSON
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border p-3 text-sm">{error}</div>}

      {!error && (
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-12 gap-2 p-3 font-semibold border-b">
            <div className="col-span-1">Week</div>
            <div className="col-span-4">Prompt</div>
            <div className="col-span-3">Entry title</div>
            <div className="col-span-2">Last edit</div>
            <div className="col-span-2">Open</div>
          </div>

          {entries.map((e) => (
            <div key={e.id} className="grid grid-cols-12 gap-2 p-3 border-b items-center">
              <div className="col-span-1">{e.week}</div>
              <div className="col-span-4">{promptTitleByWeek.get(e.week) ?? `Week ${e.week}`}</div>
              <div className="col-span-3">{e.title ?? "-"}</div>
              <div className="col-span-2">
                {e.updated_at ? new Date(e.updated_at).toLocaleDateString() : "-"}
              </div>
              <div className="col-span-2">
                <a className="underline" href={`/dashboard?week=${e.week}`} target="_blank" rel="noreferrer">
                  Open week
                </a>
              </div>
            </div>
          ))}

          {entries.length === 0 && <div className="p-3">No entries for this user yet.</div>}
        </div>
      )}
    </div>
  );
}