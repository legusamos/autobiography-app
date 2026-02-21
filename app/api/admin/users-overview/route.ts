import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/requireAdmin";
import { getAdminClient } from "@/lib/server/supabaseAdmin";

type ProfileRow = {
  id: string;
  email: string | null;
  preferred_name: string | null;
  start_date: string | null;
  email_paused: boolean | null;
  disabled: boolean | null;
};

type EntryRow = {
  user_id: string;
  status: string | null;
  updated_at: string | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeCurrentWeek(startDate: string | null) {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return clamp(week, 1, 52);
}

function normalizeStatus(s: string | null) {
  const v = String(s ?? "").toLowerCase().trim();
  if (v === "complete" || v === "completed") return "complete";
  if (v === "in_progress" || v === "in progress" || v === "progress") return "in_progress";
  return "open";
}

export async function GET(req: Request) {
  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) {
      return NextResponse.json(
        { ok: false, error: adminCheck.error },
        { status: adminCheck.status }
      );
    }

    const adminClient = getAdminClient();

    const { data: adminUsers, error: adminUsersErr } = await adminClient
      .from("admin_users")
      .select("user_id");

    if (adminUsersErr) {
      return NextResponse.json({ ok: false, error: adminUsersErr.message }, { status: 500 });
    }

    const adminIds = new Set<string>((adminUsers ?? []).map((r: any) => String(r.user_id)));

    const { data: profiles, error: profilesErr } = await adminClient
      .from("profiles")
      .select("id, email, preferred_name, start_date, email_paused, disabled");

    if (profilesErr) {
      return NextResponse.json({ ok: false, error: profilesErr.message }, { status: 500 });
    }

    const nonAdminProfiles: ProfileRow[] = (profiles ?? []).filter(
      (p: any) => p?.id && !adminIds.has(String(p.id))
    );

    const userIds = nonAdminProfiles.map((p) => p.id);

    let entries: EntryRow[] = [];
    if (userIds.length) {
      const { data: entriesData, error: entriesErr } = await adminClient
        .from("entries")
        .select("user_id, status, updated_at")
        .in("user_id", userIds);

      if (entriesErr) {
        return NextResponse.json({ ok: false, error: entriesErr.message }, { status: 500 });
      }

      entries = (entriesData ?? []) as EntryRow[];
    }

    const statsByUser = new Map<
      string,
      { open: number; in_progress: number; complete: number; last_activity: string | null }
    >();

    for (const id of userIds) {
      statsByUser.set(id, { open: 0, in_progress: 0, complete: 0, last_activity: null });
    }

    for (const e of entries) {
      const uid = String(e.user_id);
      const s = statsByUser.get(uid);
      if (!s) continue;

      const st = normalizeStatus(e.status);
      if (st === "complete") s.complete += 1;
      else if (st === "in_progress") s.in_progress += 1;
      else s.open += 1;

      const t = e.updated_at ? new Date(e.updated_at).getTime() : NaN;
      if (!Number.isNaN(t)) {
        const prev = s.last_activity ? new Date(s.last_activity).getTime() : NaN;
        if (Number.isNaN(prev) || t > prev) s.last_activity = e.updated_at!;
      }
    }

    const result = nonAdminProfiles.map((p) => {
      const s =
        statsByUser.get(p.id) ?? { open: 0, in_progress: 0, complete: 0, last_activity: null };
      const currentWeek = computeCurrentWeek(p.start_date);
      const percentComplete = Math.round((s.complete / 52) * 100);

      return {
        id: p.id,
        email: p.email,
        preferred_name: p.preferred_name,
        start_date: p.start_date,
        current_week: currentWeek,
        email_paused: Boolean(p.email_paused),
        disabled: Boolean(p.disabled),
        open_count: s.open,
        in_progress_count: s.in_progress,
        complete_count: s.complete,
        percent_complete: percentComplete,
        last_activity: s.last_activity
      };
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
