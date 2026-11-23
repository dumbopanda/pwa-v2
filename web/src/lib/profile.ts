// The signed-in person's profile row. Kept in localStorage too, so the header icon is right offline.
import { useEffect, useState } from "react";
import { supabase } from "../supabase";

/** The first 200 sign-ups are free for life. Same number as migration 0024. */
export const FOUNDING_LIMIT = 200;

export const OCCUPATIONS = ["Student", "Software / IT", "Business owner", "Doctor / Healthcare", "Teacher / Educator", "Engineer", "Finance / Banking",
  "Government employee", "Homemaker", "Retired", "Freelancer", "Sales / Marketing", "Artist / Creative", "Farmer", "Other"];

export type Profile = {
  display_name: string | null; age: number | null; location: string | null; occupation: string | null;
  avatar: string | null; member_no: number | null; email: string;
};
export type ProfPatch = Partial<Pick<Profile, "display_name" | "age" | "location" | "occupation" | "avatar">>;
/** The four text fields as typed. */
export type ProfForm = { display_name: string; age: string; location: string; occupation: string };

export const toForm = (p: Profile | null): ProfForm =>
  ({ display_name: p?.display_name ?? "", age: p?.age?.toString() ?? "", location: p?.location ?? "", occupation: p?.occupation ?? "" });

/** Typed fields to a database patch. Empty clears a field; age must be 13 to 120 (the database checks the same). */
export function formToPatch(f: ProfForm): { patch: ProfPatch } | { error: string } {
  const age = f.age.trim() === "" ? null : Number(f.age);
  if (age !== null && !(Number.isInteger(age) && age >= 13 && age <= 120)) return { error: "Age must be between 13 and 120" };
  return { patch: { display_name: f.display_name.trim() || null, age, location: f.location.trim() || null, occupation: f.occupation || null } };
}

export const filledCount = (p: Profile | null) => [p?.display_name, p?.age, p?.location, p?.occupation].filter((v) => v !== null && v !== undefined && v !== "").length;
export const isFounder = (p: Profile | null) => !!p?.member_no && p.member_no <= FOUNDING_LIMIT;

const KEY = (u: string) => `profile:${u}`;
const COLS = "display_name, age, location, occupation, avatar, member_no";
const readCache = (u: string): Profile | null => { try { return JSON.parse(localStorage.getItem(KEY(u)) ?? "null"); } catch { return null; } };
const writeCache = (u: string, p: Profile) => { try { localStorage.setItem(KEY(u), JSON.stringify(p)); } catch { /* ignore */ } };

export function useProfile(userId: string) {
  const [profile, setProfile] = useState<Profile | null>(() => readCache(userId));
  useEffect(() => {
    let live = true;
    Promise.all([supabase.from("profiles").select(COLS).eq("user_id", userId).maybeSingle(), supabase.auth.getSession()]).then(([r, s]) => {
      if (!live || !r.data) return;
      const p = { ...(r.data as Omit<Profile, "email">), email: s.data.session?.user.email ?? "" };
      setProfile(p); writeCache(userId, p);
    }, () => undefined);
    return () => { live = false; };
  }, [userId]);

  /** Saves a change. Throws when the save fails, so the caller can say so. */
  async function save(patch: ProfPatch) {
    const r = await supabase.from("profiles").update(patch).eq("user_id", userId);
    if (r.error) throw r.error;
    setProfile((prev) => { if (!prev) return prev; const p = { ...prev, ...patch }; writeCache(userId, p); return p; });
  }
  return { profile, save };
}
