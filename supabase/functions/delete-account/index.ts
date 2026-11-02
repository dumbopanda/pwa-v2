// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// Thin wrapper around public.delete_my_account() (0007_account_deletion.sql).
// The RPC does the actual work (security definer, cascades via auth.users
// FKs); this function exists so the deletion flow has a stable HTTP
// endpoint — used by the in-app flow now, and by the public web deletion
// page required by Play (built in Sprint C, block C11).
export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const { error } = await ctx.supabase.rpc("delete_my_account");

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ deleted: true });
  }),
};

/* To invoke locally:

  1. Run `supabase start`
  2. Sign in a user and grab their access token
  3. curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/delete-account' \
       --header 'Authorization: Bearer <user access token>'

*/
