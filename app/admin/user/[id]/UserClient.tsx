"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AnyRow = Record<string, any>;

function isUuid(v: any): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isNonEmptyText(v: any) {
  return typeof v === "string" && v.trim().length > 0;
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
}

export default function UserClient({ userId }: { userId: string }) {
  const router = useRouter();

  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [profile, setProfile] = useState<AnyRow | null>(null);
  const [prompts, setPrompts] = useState<AnyRow[]>([]);
  const [entries, setEntries] = useState<AnyRow[]>([]);

  // Admin control state
  const [startDateDraft, setStartDateDraft] = useState<string>("");
  const [emailPausedDraft, setEmailPausedDraft] = useState<boolean>(false);
  const [resetWeek, setResetWeek] = useState<number>(1);
  const [busy, setBusy] = useState<boolean>(false);

  // Inline expanded row state
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);

  async function adminAction(payload: any) {
    setBusy(true);
    setMessage(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes?.session?.access_token;

    if (!token) {
      setMessage("No session token. Please sign in again.");
      setBusy(false);
      return { ok: false, result: null };
    }

    const res = await fetch("/api/admin/user-actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      setMessage(json?.error ?? "Admin action failed.");
      setBusy(false);
      return { ok: false, result: null };
    }

    setBusy(false);
    return { ok: true, result: json.result ?? null };
  }

  async function adminAuthAction(payload: any) {
    setBusy(true);
    setMessage(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes?.session?.access_token;

    if (!token) {
      setMessage("No session token. Please sign in again.");
      setBusy(false);
      return { ok: false, result: null };
    }

    const res = await fetch("/api/admin/auth-actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      setMessage(json?.error ?? "Admin auth action failed.");
      setBusy(false);
      return { ok: false, result: null };
    }

    setBusy(false);
    return { ok: true, result: json.result ?? null };
  }

  async function reloadData() {
    setLoading(true);
    setMessage(null);

    const profRes = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (profRes.error) {
      setMessage(`Profile load error: ${profRes.error.message}`);
      setLoading(false);
      return;
    }
    setProfile(profRes.data ?? null);

    const promptRes = await supabase
      .from("prompts")
      .select("week, title, active")
      .eq("active", true)
      .order("week", { ascending: true });
    if (!promptRes.error) setPrompts(promptRes.data ?? []);

    const entryRes = await supabase
      .from("entries")
      .select("id, user_id, week, prompt_key, content, status, updated_at, created_at")
      .eq("user_id", userId)
      .order("week", { ascending: true });
    if (!entryRes.error) setEntries(entryRes.data ?? []);

    setLoading(false);
  }

  useEffect(() => {
    async function boot() {
      setMessage(null);

      if (!isUuid(userId)) {
        setMessage(`Invalid user id received: "${userId}"`);
        setCheckingAdmin(false);
        setLoading(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin");
      if (adminErr) {
        setMessage(`Admin check error: ${adminErr.message}`);
        setCheckingAdmin(false);
        setLoading(false);
        return;
      }

      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }

      setCheckingAdmin(false);
      await reloadData();
    }

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, userId]);

  useEffect(() => {
    if (!profile) return;
    setStartDateDraft(String(profile.start_date ?? ""));
    setEmailPausedDraft(Boolean(profile.email_paused));
  }, [profile]);

  const promptCount = useMemo(() => (prompts.length > 0 ? prompts.length : 52), [prompts.length]);

  const promptTitleByWeek = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of prompts) {
      const w = Number(p.week);
      const t = String(p.title ?? "");
      if (w) m.set(w, t || `Week ${w}`);
    }
    return m;
  }, [prompts]);

  const entryByWeek = useMemo(() => {
    const m = new Map<number, AnyRow>();
    for (const e of entries) {
      const w = Number(e.week);
      if (w) m.set(w, e);
    }
    return m;
  }, [entries]);

  const weeks = useMemo(() => {
    const out: Array<{
      week: number;
      title: string;
      status: "Open" | "In Progress" | "Complete";
      updated_at: string | null;
      content: string;
    }> = [];

    for (let w = 1; w <= promptCount; w++) {
      const e = entryByWeek.get(w);
      const title = promptTitleByWeek.get(w) ?? `Week ${w}`;

      const hasText = e && isNonEmptyText(e.content);
      const status =
        !e || !hasText ? "Open" : String(e.status) === "complete" ? "Complete" : "In Progress";

      const updated = (e?.updated_at as string | null) ?? (e?.created_at as string | null) ?? null;

      out.push({
        week: w,
        title,
        status,
        updated_at: updated,
        content: (e?.content as string) ?? ""
      });
    }

    return out;
  }, [promptCount, entryByWeek, promptTitleByWeek]);

  async function saveStartDate() {
    const start = startDateDraft.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      setMessage("Start date must be YYYY-MM-DD.");
      return;
    }

    const res = await adminAction({
      action: "set_start_date",
      target_user_id: userId,
      start_date: start
    });

    if (res.ok) await reloadData();
  }

  async function togglePaused() {
    const res = await adminAction({
      action: "set_email_paused",
      target_user_id: userId,
      email_paused: !emailPausedDraft
    });

    if (res.ok) await reloadData();
  }

  async function doResetWeek() {
    const ok = window.confirm(
      `Are you sure you want to reset Week ${resetWeek}? This will clear the user's entry for that week.`
    );
    if (!ok) return;

    const res = await adminAction({
      action: "reset_week",
      target_user_id: userId,
      week: resetWeek
    });

    if (res.ok) {
      setExpandedWeek(null);
      await reloadData();
    }
  }

  async function doResetAll() {
    const ok = window.confirm(
      "Reset ALL entries for this user? This deletes their entire writing history."
    );
    if (!ok) return;

    const res = await adminAction({
      action: "reset_all",
      target_user_id: userId
    });

    if (res.ok) {
      setExpandedWeek(null);
      await reloadData();
    }
  }

  async function toggleDisabled() {
    const next = !Boolean(profile?.disabled);
    const ok = window.confirm(
      next
        ? "Disable this user? They will be blocked from using the app."
        : "Enable this user?"
    );
    if (!ok) return;

    const res = await adminAuthAction({
      action: "set_disabled",
      target_user_id: userId,
      disabled: next
    });

    if (res.ok) await reloadData();
  }

  async function sendLoginLink() {
    const ok = window.confirm("Send a login link (magic link) to this user?");
    if (!ok) return;

    const res = await adminAuthAction({
      action: "send_magic_link",
      target_user_id: userId
    });

    if (res.ok) setMessage("Login link requested.");
  }

  async function sendPasswordReset() {
    const ok = window.confirm("Send a password reset link to this user?");
    if (!ok) return;

    const res = await adminAuthAction({
      action: "send_password_reset",
      target_user_id: userId
    });

    if (res.ok) setMessage("Password reset link requested.");
  }

  if (checkingAdmin) return <div className="p-6">Checking admin access...</div>;
  if (loading) return <div className="p-6">Loading user...</div>;

  const cardClass = "border rounded-xl p-4";
  const buttonClass = "rounded-lg border px-3 py-2";
  const thClass = "py-2 px-3 text-xs";
  const tdClass = "py-2 px-3 text-sm";

  function rowBg(status: string) {
    if (status === "Complete") return "bg-green-100";
    if (status === "In Progress") return "bg-blue-100";
    return "bg-white";
  }

  function statusColor(status: string) {
    if (status === "Complete") return "text-green-800";
    if (status === "In Progress") return "text-blue-800 italic";
    return "text-black";
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm opacity-80 cursor-pointer" onClick={() => router.push("/admin")}>
              Admin
            </div>
            <h1 className="text-2xl font-semibold">
              {(profile?.preferred_name as string) ?? "User"}{" "}
              <span className="text-sm opacity-70">({userId})</span>
            </h1>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button className={buttonClass} onClick={() => router.push("/admin")}>
              Back to Admin
            </button>
          </div>
        </div>

        {message ? <div className={cardClass}>{message}</div> : null}

        <div className={cardClass}>
          <div className="text-sm opacity-80">Email: {profile?.email ?? "-"}</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">Start date (YYYY-MM-DD)</div>
              <input
                className="mt-2 w-full border rounded-lg px-3 py-2"
                value={startDateDraft}
                onChange={(e) => setStartDateDraft(e.target.value)}
                disabled={busy}
              />
              <button className={`${buttonClass} mt-2`} onClick={saveStartDate} disabled={busy}>
                Save start date
              </button>
            </div>

            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">Weekly emails</div>
              <div className="mt-2 text-sm">
                Status:{" "}
                <span className="font-semibold">{emailPausedDraft ? "Paused" : "Active"}</span>
              </div>
              <button className={`${buttonClass} mt-2`} onClick={togglePaused} disabled={busy}>
                {emailPausedDraft ? "Resume emails" : "Pause emails"}
              </button>
            </div>

            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">Reset tools</div>
              <div className="mt-2 flex items-center gap-2">
                <select
                  className="border rounded-lg px-3 py-2"
                  value={resetWeek}
                  onChange={(e) => setResetWeek(Number(e.target.value))}
                  disabled={busy}
                >
                  {Array.from({ length: 52 }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>
                      Week {w}
                    </option>
                  ))}
                </select>
                <button className={buttonClass} onClick={doResetWeek} disabled={busy}>
                  Reset week
                </button>
              </div>

              <button className={`${buttonClass} mt-2`} onClick={doResetAll} disabled={busy}>
                Reset ALL
              </button>
            </div>

            <div className="border rounded-lg p-3">
              <div className="text-xs opacity-70">Account</div>

              <div className="mt-2 text-sm">
                Disabled:{" "}
                <span className="font-semibold">{profile?.disabled ? "Yes" : "No"}</span>
              </div>

              <button className={`${buttonClass} mt-2`} onClick={toggleDisabled} disabled={busy}>
                {profile?.disabled ? "Enable user" : "Disable user"}
              </button>

              <button className={`${buttonClass} mt-2`} onClick={sendLoginLink} disabled={busy}>
                Send login link
              </button>

              <button className={`${buttonClass} mt-2`} onClick={sendPasswordReset} disabled={busy}>
                Send password reset
              </button>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-lg font-semibold">Weeks</div>
            <div className="text-sm opacity-80">Click a row to expand</div>
          </div>

          <div className="mt-3 border rounded-lg overflow-hidden">
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b">
                    <th className={thClass}>Week</th>
                    <th className={thClass}>Prompt</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Updated</th>
                    <th className={thClass}>Preview</th>
                  </tr>
                </thead>

                <tbody>
                  {weeks.map((w) => {
                    const isExpanded = expandedWeek === w.week;

                    return (
                      <Fragment key={w.week}>
                        <tr
                          className={`border-b ${rowBg(w.status)} cursor-pointer`}
                          onClick={() => setExpandedWeek(isExpanded ? null : w.week)}
                        >
                          <td className={tdClass}>
                            <span className="opacity-60 mr-2">{isExpanded ? "▾" : "▸"}</span>
                            {w.week}
                          </td>
                          <td className={tdClass}>{w.title}</td>
                          <td className={`${tdClass} ${statusColor(w.status)}`}>{w.status}</td>
                          <td className={tdClass}>{formatDateTime(w.updated_at)}</td>
                          <td className={tdClass}>
                            {isNonEmptyText(w.content)
                              ? w.content.slice(0, 90) + (w.content.length > 90 ? "..." : "")
                              : "-"}
                          </td>
                        </tr>

                        {isExpanded ? (
                          <tr className={`border-b ${rowBg(w.status)}`}>
                            <td className={tdClass} colSpan={5}>
                              <div className="border rounded-lg p-3 bg-white">
                                <div className="text-sm opacity-80">
                                  Week {w.week} • {w.title}
                                </div>
                                <div className="mt-2 whitespace-pre-wrap text-sm">
                                  {isNonEmptyText(w.content) ? w.content : "(No content)"}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 text-xs opacity-70">
            Tip: click the same row again to collapse it.
          </div>
        </div>
      </div>
    </div>
  );
}