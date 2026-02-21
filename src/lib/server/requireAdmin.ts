import { createClient } from "@supabase/supabase-js";

type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function requireAdmin(req: Request): Promise<AdminCheck> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }

  const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // Use anon key to validate the user token
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userRes, error: userErr } = await supabase.auth.getUser(token);

  if (userErr || !userRes?.user?.id) {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const userId = userRes.user.id;

  // Now check admin_users using the SERVICE ROLE (server-only)
  const service = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminDb = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: adminRow, error: adminErr } = await adminDb
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminErr) {
    return { ok: false, status: 500, error: adminErr.message };
  }

  if (!adminRow) {
    return { ok: false, status: 403, error: "Admin access required" };
  }

  return { ok: true, userId };
}