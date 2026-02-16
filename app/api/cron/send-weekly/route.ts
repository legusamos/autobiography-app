import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getWeekFromStartDate(startDateISO: string): number {
  const start = new Date(startDateISO + "T00:00:00Z");
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((now.getTime() - start.getTime()) / msPerDay);
  const week = Math.floor(days / 7) + 1;
  return Math.max(1, Math.min(52, week));
}

export async function GET(req: Request) {
  try {
    const cronSecret = requireEnv("CRON_SECRET");
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = requireEnv("RESEND_API_KEY");
    const appUrl = requireEnv("APP_URL");

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const resend = new Resend(resendKey);

    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id, email, email_opt_in, start_date")
      .eq("email_opt_in", true)
      .not("start_date", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let sent = 0;
    let skipped = 0;

    for (const p of profiles ?? []) {
      if (!p.email || !p.start_date) {
        skipped += 1;
        continue;
      }

      const week = getWeekFromStartDate(p.start_date);

      const { data: promptRow, error: pErr } = await admin
        .from("prompts")
        .select("title, coaching, questions")
        .eq("week", week)
        .eq("active", true)
        .single();

      if (pErr || !promptRow) {
        skipped += 1;
        continue;
      }

      const questions: string[] = (promptRow.questions ?? []) as unknown as string[];

      const nextPath = `/dashboard?week=${week}`;
      const link = `${appUrl}/login?next=${encodeURIComponent(nextPath)}`;

      const subject = `Week ${week} Prompt: ${promptRow.title}`;

      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.4;">
          <h2 style="margin: 0 0 8px 0;">Week ${week}: ${promptRow.title}</h2>
          <p style="margin: 0 0 12px 0;">${promptRow.coaching}</p>
          <ol>
            ${questions.map((q) => `<li style="margin-bottom: 8px;">${q}</li>`).join("")}
          </ol>
          <p style="margin: 16px 0;">
            <a href="${link}" style="display: inline-block; padding: 10px 14px; border: 1px solid #333; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Write this week’s entry
            </a>
          </p>
        </div>
      `;

      const res = await resend.emails.send({
        from: "Autobiography <weekly@autobiography.iconpublishingllc.com>",
        to: p.email,
        subject,
        html
      });

      if (!("error" in res)) sent += 1;
      else skipped += 1;
    }

    return NextResponse.json({ ok: true, sent, skipped, total: (profiles ?? []).length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 });
  }
}
