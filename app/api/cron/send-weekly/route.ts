import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminClient } from "@/lib/server/supabaseAdmin";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: Request) {
  try {
    // Cron auth
    const cronSecret = mustEnv("CRON_SECRET");
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const resend = new Resend(mustEnv("RESEND_API_KEY"));
    const from = mustEnv("RESEND_FROM_EMAIL");
    const appUrl = mustEnv("NEXT_PUBLIC_APP_URL");

    const adminClient = getAdminClient();

    // Get active, non-disabled users
    const { data: profiles, error: profErr } = await adminClient
      .from("profiles")
      .select("id, email, preferred_name, start_date, email_day, email_paused, disabled")
      .eq("disabled", false);

    if (profErr) {
      return NextResponse.json({ ok: false, error: profErr.message }, { status: 500 });
    }

    const now = new Date();

    let sent = 0;
    let skippedPaused = 0;
    let skippedNoStart = 0;
    let skippedNoEmail = 0;

    for (const p of profiles ?? []) {
      if (!p?.email) {
        skippedNoEmail++;
        continue;
      }

      if (p.email_paused) {
        skippedPaused++;
        continue;
      }

      if (!p.start_date) {
        skippedNoStart++;
        continue;
      }

      // Compute current week from start_date
      const start = new Date(String(p.start_date) + "T00:00:00");
      const diffMs = now.getTime() - start.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const week = Math.max(1, Math.min(52, Math.floor(diffDays / 7) + 1));

      // Get prompt for that week
      const { data: prompt, error: promptErr } = await adminClient
        .from("prompts")
        .select("week, title, question, prompt_key")
        .eq("week", week)
        .single();

      if (promptErr || !prompt) {
        continue;
      }

      const link = `${appUrl}/week?week=${week}`;

      await resend.emails.send({
        from,
        to: p.email,
        subject: `Week ${week}: ${prompt.title ?? "Your autobiography prompt"}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height:1.5">
            <p>Hello${p.preferred_name ? " " + String(p.preferred_name) : ""},</p>
            <p><strong>Week ${week}</strong></p>
            <p>${prompt.question ? String(prompt.question) : ""}</p>
            <p><a href="${link}">Open this week’s question</a></p>
            <p style="opacity:0.7;font-size:12px">If you did not request these emails, you can ignore this message.</p>
          </div>
        `
      });

      sent++;
    }

    return NextResponse.json({
      ok: true,
      sent,
      skippedPaused,
      skippedNoStart,
      skippedNoEmail
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}