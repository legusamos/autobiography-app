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
};

export default function DashboardPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const week = useMemo(() => {
    const w = Number(sp.get("week") || "1");
    if (!Number.isFinite(w)) return 1;
    return Math.max(1, Math.min(52, w));
  }, [sp]);

  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState<PromptRow | null>(null);
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMessage(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.push("/login");
        return;
      }

      const { data: promptRow, error: promptErr } = await supabase
        .from("prompts")
        .select("prompt_key, week, title, category, coaching, questions, helpful_followups")
        .eq("week", week)
        .eq("active", true)
        .single();

      if (promptErr) {
        setMessage(`Prompt load error: ${promptErr.message}`);
        setLoading(false);
        return;
      }

      setPrompt(promptRow as PromptRow);

      const { data: existing, error: entryErr } = await supabase
        .from("entries")
        .select("id, user_id, prompt_key, week, title, content, status")
        .eq("user_id", auth.user.id)
        .eq("week", week)
        .maybeSingle();

      if (entryErr) {
        setMessage(`Entry load error: ${entryErr.message}`);
        setLoading(false);
        return;
      }

      if (existing) {
        const e = existing as EntryRow;
        setEntry(e);
        setTitle(e.title ?? "");
        setContent(e.content ?? "");
      } else {
        setEntry(null);
        setTitle("");
        setContent("");
      }

      setLoading(false);
    }

    load();
  }, [router, week]);

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
      return;
    }

    const { data, error } = await supabase.from("entries").insert(payload).select().single();
    if (error) setMessage(`Save error: ${error.message}`);
    else {
      setEntry(data as EntryRow);
      setMessage("Saved.");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Week {week}</h1>
        <div className="flex gap-2">
          <button className="rounded-lg border px-3 py-2" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

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
        <div className="rounded-xl border p-4">
          No prompt found for Week {week}. Seed prompts first.
        </div>
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
          {message && <span className="text-sm">{message}</span>}
        </div>
      </div>
    </div>
  );
}
