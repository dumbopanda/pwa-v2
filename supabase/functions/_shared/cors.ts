// Browser origins allowed to call a function: ALLOWED_ORIGINS secret, comma separated.
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}

export function reply(req: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(req) });
}
