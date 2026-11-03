import { APP_NAME } from "../config";
import { supabase } from "../supabase";

// Placeholder until the Today screen (step 5) and quick log (step 2) land.
export default function Home() {
  return (
    <main className="screen stack">
      <h1>{APP_NAME}</h1>
      <p className="muted">You're set up. Logging arrives in the next build.</p>
      <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </main>
  );
}
