import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/requireAdmin";
import { getAdminClient } from "@/lib/server/supabaseAdmin";
import { Resend } from "resend";

type Action =
  | "set_disabled"
  | "send_magic_link"
  | "send_password_reset"
  | "confirm_email";

type Body = {
  action: Action;
  target_user_id: string;
  disabled?: boolean;
};

function isUuid(v: any): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) {
      return NextResponse.json(
        { ok: false, error: adminCheck.error },
        { status: adminCheck.status }
      );
    }

    const body = (await req.json()) as Body;

    if (!body?.action || !body?.target_user_id) {
      return NextResponse.json(
        { ok: false, error: "Missing action or target_user_id" },
        { status: 400 }
      );
    }

    if (!isUuid(body.target_user_id)) {
      return NextResponse.json(
        { ok: false, error: "target_user_id must be a valid UUID" },
        { status: 400 }
      );
    }

    const adminClient = getAdminClient();

    // Resend
    const resend = new Resend(mustEnv("RESEND_API_KEY"));
    const from = mustEnv("RESEND_FROM_EMAIL"); // ex: "MyAutobiography <noreply@autobiography.iconpublishingllc.com>"
    const appUrl = mustEnv("NEXT_PUBLIC_APP_URL"); // ex: "https://autobiography-app-omega.vercel.app"

    async function getUserEmail(userId: string) {
      const { data, error } = await adminClient.auth.admin.getUserById(userId);
      if (error) throw new Error(error.message);
      const email = data?.user?.email;
      if (!email) throw new Error("User has no email");
      return email;
    }

    async function sendResendEmail(to: string, subject: string, html: string) {
      const { error } = await resend.emails.send({
        from,
        to,
        subject,
        html
      });
      if (error) throw new Error(error.message);
    }

    // ============================
    // ACTION: disable/enable user
    // ============================
    if (body.action === "set_disabled") {
      const disabled = Boolean(body.disabled);

      const { error } = await adminClient
        .from("profiles")
        .update({ disabled })
        .eq("id", body.target_user_id);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    // ============================
    // ACTION: send login link (magic link)
    // ============================
    if (body.action === "send_magic_link") {
      const email = await getUserEmail(body.target_user_id);

      const { data, error } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          redirectTo: `${appUrl}/login`
        }
      });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const actionLink = (data as any)?.properties?.action_link ?? null;
      if (!actionLink) {
        return NextResponse.json(
          { ok: false, error: "Supabase did not return an action_link." },
          { status: 500 }
        );
      }

      await sendResendEmail(
        email,
        "Your MyAutobiography sign-in link",
        `
          <div style="font-family: Arial, sans-serif; line-height:1.5">
            <p>Here is your secure sign-in link to MyAutobiography.</p>
            <p><a href="${actionLink}">Sign in</a></p>
            <p>If you did not request this, you can ignore this email.</p>
          </div>
        `
      );

      return NextResponse.json({
        ok: true,
        result: { email }
      });
    }

    // ============================
    // ACTION: send password reset link
    // ============================
    if (body.action === "send_password_reset") {
      const email = await getUserEmail(body.target_user_id);

      const { data, error } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: `${appUrl}/login`
        }
      });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const actionLink = (data as any)?.properties?.action_link ?? null;
      if (!actionLink) {
        return NextResponse.json(
          { ok: false, error: "Supabase did not return an action_link." },
          { status: 500 }
        );
      }

      await sendResendEmail(
        email,
        "Reset your MyAutobiography password",
        `
          <div style="font-family: Arial, sans-serif; line-height:1.5">
            <p>Use the link below to reset your password.</p>
            <p><a href="${actionLink}">Reset password</a></p>
            <p>If you did not request this, you can ignore this email.</p>
          </div>
        `
      );

      return NextResponse.json({
        ok: true,
        result: { email }
      });
    }

    // ============================
    // ACTION: confirm email (optional)
    // ============================
    if (body.action === "confirm_email") {
      const { data, error } = await adminClient.auth.admin.updateUserById(
        body.target_user_id,
        { email_confirm: true } as any
      );

      if (error) {
        return NextResponse.json(
          { ok: false, error: "Confirm email failed: " + error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, result: { user: data.user } });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}