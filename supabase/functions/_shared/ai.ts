// Shared by parse-entry and month-review: auth'd quota check and the model call.
import { createClient } from "@supabase/supabase-js";

export type Quota = { ok: true; left_today: number } | { ok: false; reason: string; retry_after_s?: number };

/** Count this call against the caller's own quota (10/min, 50/day), using their JWT. */
export async function takeQuota(req: Request, fn: "parse" | "review"): Promise<Quota | "error"> {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("ai_take_quota", { p_fn: fn });
  if (error || !data) return "error";
  return data.ok ? { ok: true, left_today: data.left_today } : { ok: false, reason: data.reason, retry_after_s: data.retry_after_s };
}

/** POST to the Anthropic Messages API. Returns the parsed body or null on any failure. */
export async function callModel(body: unknown, timeoutMs = 15000): Promise<unknown | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
