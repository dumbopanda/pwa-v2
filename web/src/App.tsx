import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import SignIn, { CONSENT_KEY } from "./screens/SignIn";
import Onboarding from "./screens/Onboarding";
import Shell from "./screens/Shell";
import { closeUser } from "./lib/store";

const KEY = (u: string) => `onboarded:${u}`;
const remembered = (u: string) => { try { return localStorage.getItem(KEY(u)) === "1"; } catch { return false; } };
const forget = (u: string) => { try { localStorage.removeItem(KEY(u)); } catch { /* ignore */ } };
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
  // Consent log: the ticked box from sign-in, saved once signed in. Kept and retried on next open if it fails.
  useEffect(() => {
    if (!userId) return;
    let props: Record<string, unknown> | null = null;
    try { props = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null"); } catch { return; }
    if (!props) return;
    supabase.from("events").insert({ name: "consent_accepted", props })
      .then(({ error }) => { if (!error) try { localStorage.removeItem(CONSENT_KEY); } catch { /* ignore */ } });
  }, [userId]);
  useEffect(() => {
    if (!userId) { setOnboarded(undefined); return; }
    setLoadError(false);
    // Once onboarded, always onboarded: remember it so the app opens offline.
    // If the server says otherwise (account reset), drop the local copy and start over.
    if (remembered(userId)) {
      setOnboarded(true);
      supabase.from("profiles").select("onboarded_at").eq("user_id", userId).maybeSingle()
        .then(({ data, error }) => {
          if (error || !data || data.onboarded_at) return; // only an explicit "not onboarded" row resets
          forget(userId); void closeUser(true); setOnboarded(false);
        });
      return;
    }
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
