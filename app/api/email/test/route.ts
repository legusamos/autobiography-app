import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.TEST_EMAIL_TO;

  if (!apiKey) return NextResponse.json({ error: "Missing RESEND_API_KEY" }, { status: 500 });
  if (!to) return NextResponse.json({ error: "Missing TEST_EMAIL_TO" }, { status: 500 });

  const resend = new Resend(apiKey);

  const result = await resend.emails.send({
    from: "Autobiography <weekly@autobiography.iconpublishingllc.com>",
    to,
    subject: "Test email from Autobiography app",
    html: "<p>This is a test email. If you received this, Resend is working.</p>"
  });

  return NextResponse.json({ ok: true, result });
}
