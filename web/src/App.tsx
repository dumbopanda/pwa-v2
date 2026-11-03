import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import SignIn from "./screens/SignIn";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) { setOnboarded(undefined); return; }
    setLoadError(false);
    supabase.from("profiles").select("onboarded_at").eq("user_id", userId).maybeSingle()
      .then(({ data, error }) => (error ? setLoadError(true) : setOnboarded(!!data?.onboarded_at)));
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
  if (!onboarded) return <Onboarding userId={session.user.id} onDone={() => setOnboarded(true)} />;
  return <Home />;
}
