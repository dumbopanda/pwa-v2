// Shared by parse-entry and month-review: auth'd quota check and the model call.
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_MODEL } from "./parse.ts";

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

/**
 * Cloudflare Workers AI (free daily allowance; Cloudflare doesn't train on it
 * or keep it). Secrets: CF_ACCOUNT_ID, CF_API_TOKEN, optional AI_MODEL.
 * Asks for JSON-schema output; if the model refuses that, retries in plain
 * mode. Returns the response body, or null on any failure.
 */
export async function callModel(messages: { role: string; content: string }[], schema: object, maxTokens: number, timeoutMs = 15000): Promise<unknown | null> {
  const account = Deno.env.get("CF_ACCOUNT_ID"), token = Deno.env.get("CF_API_TOKEN");
  if (!account || !token) return null;
  const model = Deno.env.get("AI_MODEL") || DEFAULT_MODEL;
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
  const send = (json: boolean) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0, ...(json ? { response_format: { type: "json_schema", json_schema: schema } } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  try {
    let r = await send(true);
    if (r.status === 400) r = await send(false);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
