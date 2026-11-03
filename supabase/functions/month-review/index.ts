import "@supabase/functions-js/edge-runtime.d.ts";
import { reply, corsHeaders } from "../_shared/cors.ts";
import { callModel, takeQuota } from "../_shared/ai.ts";
import { buildReviewRequest, validateReview, type ReviewFacts } from "../_shared/review.ts";
import { extractToolInput } from "../_shared/parse.ts";

// Receives numbers that plain code already computed and returns words about
// them. It never changes a number: any reply with a number that isn't in the
// input is dropped and the app shows its no-AI template instead. verify_jwt = true.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);

  let facts: ReviewFacts;
  try { facts = (await req.json()).facts; } catch { return reply(req, { error: "bad_request" }, 400); }
  if (!facts || typeof facts.month !== "string" || !Array.isArray(facts.categories) || !Array.isArray(facts.top_places)
      || facts.categories.length > 60 || facts.top_places.length > 10 || JSON.stringify(facts).length > 8000)
    return reply(req, { error: "bad_request" }, 400);

  const q = await takeQuota(req, "review");
  if (q === "error") return reply(req, { error: "ai_unavailable" }, 503);
  if (!q.ok) return reply(req, { error: q.reason, retry_after_s: q.retry_after_s }, 429);

  const body = await callModel(buildReviewRequest(facts), 25000);
  const review = body ? validateReview(extractToolInput(body, "write_review"), facts) : null;
  if (!review) return reply(req, { error: "ai_unavailable" }, 503);
  return reply(req, { review });
});
