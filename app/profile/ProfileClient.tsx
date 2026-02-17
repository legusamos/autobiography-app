"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type ProfileRow = {
  id: string;
  email: string | null;
  preferred_name: string | null;
  ui_text_size: "normal" | "large" | null;
  ui_contrast: "default" | "high" | null;
  preferred_email_day: string | null;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export default function ProfileClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const [preferredName, setPreferredName] = useState("");
  const [textSize, setTextSize] = useState<"normal" | "large">("normal");
  const [contrast, setContrast] = useState<"default" | "high">("default");
  const [preferredEmailDay, setPreferredEmailDay] = useState<string>("Monday");

  // Unsaved-changes protection
  const savedSnapshotRef = useRef<string>("");

  function currentSnapshot() {
    return JSON.stringify({
      preferredName,
      textSize,
      contrast,
      preferredEmailDay
    });
  }

  const snapshot = currentSnapshot();
  const isDirty = snapshot !== savedSnapshotRef.current;

  function confirmDiscardIfDirty() {
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Leave without saving?");
  }

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  async function loadProfile() {
    setLoading(true);
    setMessage(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, preferred_name, ui_text_size, ui_contrast, preferred_email_day")
      .eq("id", auth.user.id)
      .single();

    if (error) {
      setMessage(`Profile load error: ${error.message}`);
      setLoading(false);
      return;
    }

    const p = data as ProfileRow;
    setProfile(p);

    const initialPreferredName = p.preferred_name ?? "";
    const initialTextSize: "normal" | "large" = p.ui_text_size === "large" ? "large" : "normal";
    const initialContrast: "default" | "high" = p.ui_contrast === "high" ? "high" : "default";
    const initialPreferredEmailDay =
      DAYS.includes((p.preferred_email_day ?? "Monday") as any) ? (p.preferred_email_day ?? "Monday") : "Monday";

    setPreferredName(initialPreferredName);
    setTextSize(initialTextSize);
    setContrast(initialContrast);
    setPreferredEmailDay(initialPreferredEmailDay);

    // Establish baseline snapshot for dirty-check
    savedSnapshotRef.current = JSON.stringify({
      preferredName: initialPreferredName,
      textSize: initialTextSize,
      contrast: initialContrast,
      preferredEmailDay: initialPreferredEmailDay
    });

    setLoading(false);
  }

  useEffect(() => {
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setMessage(null);

    if (!profile) return;

    const payload = {
      preferred_name: preferredName.trim() || null,
      ui_text_size: textSize,
      ui_contrast: contrast,
      preferred_email_day: preferredEmailDay
    };

    const { error } = await supabase.from("profiles").update(payload).eq("id", profile.id);

    if (error) {
      setMessage(`Save error: ${error.message}`);
      return;
    }

    setMessage("Saved.");

    // Clear dirty state immediately after successful save
    savedSnapshotRef.current = snapshot;

    // Reload from DB to confirm
    await loadProfile();
  }

  async function signOut() {
    if (!confirmDiscardIfDirty()) return;
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="p-6">Loading profile...</div>;

  // True high contrast theme
  const high = contrast === "high";
  const pageClass = high ? "bg-black text-white min-h-screen" : "min-h-screen";
  const cardClass = high ? "border border-white rounded-xl p-4" : "border rounded-xl p-4";
  const inputClass = high
    ? "w-full rounded-lg border border-white bg-black text-white p-2"
    : "w-full rounded-lg border p-2";
  const buttonClass = high ? "rounded-lg border border-white px-3 py-2" : "rounded-lg border px-3 py-2";
  const primaryButtonClass = high
    ? "rounded-lg bg-white text-black px-4 py-2 font-semibold"
    : "rounded-lg border px-4 py-2 font-semibold";

  const contentClass = textSize === "large" ? "text-lg leading-relaxed" : "text-base";

  return (
    <div className={`${pageClass} ${contentClass}`}>
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Profile</h1>
            <div className={high ? "text-sm" : "text-sm opacity-80"}>Update your preferences anytime.</div>
          </div>
          <div className="flex gap-2">
            <button
              className={buttonClass}
              onClick={() => {
                if (!confirmDiscardIfDirty()) return;
                router.push("/dashboard");
              }}
            >
              Back to Dashboard
            </button>
            <button className={buttonClass} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {message && <div className={cardClass}>{message}</div>}

        {isDirty ? (
          <div className={high ? "text-sm" : "text-sm opacity-80"}>Not saved</div>
        ) : (
          <div className={high ? "text-sm" : "text-sm opacity-80"}>All changes saved</div>
        )}

        <div className={cardClass}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-semibold">Preferred name (optional)</label>
              <div className={high ? "text-sm" : "text-sm opacity-80"}>
                This can be used to personalize prompts and the final autobiography.
              </div>
              <input
                className={inputClass}
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                placeholder="Example: Matt"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold">Text size</label>
                <select className={inputClass} value={textSize} onChange={(e) => setTextSize(e.target.value as any)}>
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold">Contrast</label>
                <select className={inputClass} value={contrast} onChange={(e) => setContrast(e.target.value as any)}>
                  <option value="default">Default</option>
                  <option value="high">High contrast</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold">Preferred weekly email day</label>
              <div className={high ? "text-sm" : "text-sm opacity-80"}>
                We will use this later for weekly prompt emails.
              </div>
              <select
                className={inputClass}
                value={preferredEmailDay}
                onChange={(e) => setPreferredEmailDay(e.target.value)}
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button className={primaryButtonClass} onClick={save}>
                Save
              </button>
              {profile?.email ? (
                <span className={high ? "text-sm" : "text-sm opacity-80"}>Signed in as {profile.email}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={high ? "text-sm" : "text-sm opacity-80"}>
          More profile fields can be added later without changing how entries work.
        </div>
      </div>
    </div>
  );
}