import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// Called once a day by .github/workflows/keepalive.yml so the free project is never idle
// for 7 days (which pauses it). Public on purpose: it takes no input, returns only
// {ok}, and touches no user data. It calls otp_discard(0): a real database round trip that
// deletes nothing (no row has id 0), and a function the server role may already run, so no
// extra permission is needed.
Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.rpc("otp_discard", { p_id: 0 });
  return Response.json({ ok: !error }, { status: error ? 500 : 200 });
});
