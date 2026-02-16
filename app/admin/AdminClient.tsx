"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ProfileRow = {
  id: string;
  email: string | null;
  role: string;
  start_date: string | null;
  created_at: string;
};

export default function AdminClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.push("/login?next=/admin");
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

      const role = (me as any)?.role as string;
      setMeRole(role);

      if (role !== "admin") {
        setError("Not authorized.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, role, start_date, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      setProfiles((data ?? []) as ProfileRow[]);
      setLoading(false);
    }

    load();
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="p-6">Loading admin...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <div className="text-sm opacity-80">Role: {meRole ?? "unknown"}</div>
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg border px-3 py-2" onClick={() => router.push("/dashboard")}>
            Dashboard
          </button>
          <button className="rounded-lg border px-3 py-2" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border p-3 text-sm">{error}</div>}

      {!error && (
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-12 gap-2 p-3 font-semibold border-b">
            <div className="col-span-5">Email</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-2">Start date</div>
            <div className="col-span-2">Created</div>
            <div className="col-span-1"></div>
          </div>

          {profiles.map((p) => (
            <div key={p.id} className="grid grid-cols-12 gap-2 p-3 border-b items-center">
              <div className="col-span-5">{p.email ?? "(no email)"}</div>
              <div className="col-span-2">{p.role}</div>
              <div className="col-span-2">{p.start_date ?? "-"}</div>
              <div className="col-span-2">{new Date(p.created_at).toLocaleDateString()}</div>
              <div className="col-span-1 text-right">
                <Link className="underline" href={`/admin/user/${p.id}`}>
                  View
                </Link>
              </div>
            </div>
          ))}

          {profiles.length === 0 && <div className="p-3">No users found.</div>}
        </div>
      )}
    </div>
  );
}
