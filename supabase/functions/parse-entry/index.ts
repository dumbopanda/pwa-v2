import "@supabase/functions-js/edge-runtime.d.ts";
import { reply, corsHeaders } from "../_shared/cors.ts";
import { callModel, takeQuota } from "../_shared/ai.ts";
import { buildMessages, extractJson, MAX_TEXT, normalizeProposal, PROPOSAL_SCHEMA, type ParseInput } from "../_shared/parse.ts";

// Reads one quick-log message and proposes an entry. Sends the model ONLY the
// text, the caller's own account and category names, and today's date.
// Never balances, other entries, or anything else. verify_jwt = true.
// The app always shows a confirm card; nothing here saves anything.

const names = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 40) ? v : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(req, { error: "bad_request" }, 400); }

  const accounts = names(b.accounts, 50), categories = names(b.categories, 200);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : null;
  if (!text || text.length > MAX_TEXT || !accounts || !categories || !today) return reply(req, { error: "bad_request" }, 400);
  const input: ParseInput = { text, accounts, categories, today };

  const q = await takeQuota(req, "parse");
  if (q === "error") return reply(req, { error: "ai_unavailable" }, 503);
  if (!q.ok) return reply(req, { error: q.reason, retry_after_s: q.retry_after_s }, 429);

  const body = await callModel(buildMessages(input), PROPOSAL_SCHEMA, 300);
  const proposal = body ? normalizeProposal(extractJson(body), input) : null;
  if (!proposal) return reply(req, { error: "ai_unavailable" }, 503);
  return reply(req, { proposal, left_today: q.left_today });
});
