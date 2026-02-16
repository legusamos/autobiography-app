"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
    }

    const next = sp.get("next");
    router.push(next || "/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Autobiography</h1>

        <div className="flex gap-2">
          <button
            className={`px-3 py-2 rounded-lg border ${mode === "signin" ? "font-semibold" : ""}`}
            onClick={() => setMode("signin")}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`px-3 py-2 rounded-lg border ${mode === "signup" ? "font-semibold" : ""}`}
            onClick={() => setMode("signup")}
            type="button"
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm">Email</label>
            <input
              className="w-full rounded-lg border p-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">Password</label>
            <input
              className="w-full rounded-lg border p-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Password"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button className="w-full rounded-lg border p-2 font-semibold" type="submit">
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
