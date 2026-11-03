import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import SignIn from "./screens/SignIn";
import Onboarding from "./screens/Onboarding";
import Shell from "./screens/Shell";
import { closeUser } from "./lib/store";

const KEY = (u: string) => `onboarded:${u}`;
const remembered = (u: string) => { try { return localStorage.getItem(KEY(u)) === "1"; } catch { return false; } };
const remember = (u: string) => { try { localStorage.setItem(KEY(u), "1"); } catch { /* ignore */ } };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => { setSession(s); if (e === "SIGNED_OUT") void closeUser(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) { setOnboarded(undefined); return; }
    setLoadError(false);
    // Once onboarded, always onboarded: remember it so the app opens offline.
    if (remembered(userId)) { setOnboarded(true); return; }
    supabase.from("profiles").select("onboarded_at").eq("user_id", userId).maybeSingle()
      .then(({ data, error }) => {
        if (error) return setLoadError(true);
        if (data?.onboarded_at) remember(userId);
        setOnboarded(!!data?.onboarded_at);
      });
  }, [userId]);

  if (session === undefined) return null;
  if (!session) return <SignIn />;
  if (loadError) return (
    <main className="screen stack">
      <p className="error">Couldn't load your account. Check your connection.</p>
      <button className="btn" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
  if (onboarded === undefined) return null;
  if (!onboarded) return <Onboarding userId={session.user.id} onDone={() => { remember(session.user.id); setOnboarded(true); }} />;
  return <Shell userId={session.user.id} />;
}
