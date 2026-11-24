// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Email sign-in by 6-digit code. Two actions, one endpoint:
//   POST { action: "send",   email }        -> emails a fresh code
//   POST { action: "verify", email, code }  -> returns a Supabase session
//   POST { action: "waitlist", email }      -> adds the address to the waitlist (invitations full)
//
// Every limit (3-min expiry, 150s resend cooldown, hourly/daily caps, 5 wrong guesses,
// consume-on-success) is enforced by otp_issue()/otp_check() in
// 0011_email_otp.sql and 0013, not here. This function only generates the code,
// hashes it, sends the email, and mints the session after otp_check() says ok.
//
// Secrets: OTP_PEPPER (HMAC key for stored code hashes), SMTP_HOST, SMTP_USER,
// SMTP_PASS, and optional SMTP_FROM (an address the SMTP user may send as, e.g.
// noreply@ alias in Zoho). Old GMAIL_USER / GMAIL_APP_PASSWORD still work.

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EMAIL_RE = /^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/;

// Browser origins allowed to call this (the web app). Comma-separated in the
// ALLOWED_ORIGINS secret, e.g. "https://app.example.com,http://localhost:5173".
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// Product name for the email: "Spend Roll" on prod, "Spend Roll Dev" on dev (APP_NAME secret).
const APP_NAME = Deno.env.get("APP_NAME") || "Spend Roll";

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}
export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    const res = await handle(req);
    for (const [k, v] of Object.entries(cors(req))) res.headers.set(k, v);
    return res;
  },
};

async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    // Without the pepper, codes can't be hashed safely: refuse rather than guess.
    if (!Deno.env.get("OTP_PEPPER")) return json({ error: "email_unavailable" }, 503);

    let body: { action?: string; email?: string; code?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad_request" }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);

    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);

    if (body.action === "waitlist") return waitlist(email, clientIp(req));
    if (body.action === "send") return send(email, clientIp(req));
    if (body.action === "verify") return verify(email, (typeof body.code === "string" ? body.code : "").trim());
    return json({ error: "bad_request" }, 400);
}

// Invitations full: a new address gets "full" (the app shows the waitlist); existing accounts are unaffected.
async function isFull(email: string): Promise<boolean | null> {
  const { data, error } = await admin.rpc("signup_blocked", { p_email: email });
  return error ? null : data === true;
}

async function waitlist(email: string, ip: string | null): Promise<Response> {
  const { data, error } = await admin.rpc("join_waitlist", { p_email: email, p_ip: ip });
  if (error) return json({ error: "server_error" }, 500);
  return data.ok ? json({ ok: true }) : json({ error: data.reason }, data.reason === "invalid_email" ? 400 : 429);
}

async function send(email: string, ip: string | null): Promise<Response> {
  const full = await isFull(email);
  if (full === null) return json({ error: "server_error" }, 500);
  if (full) return json({ error: "full" }, 403);
  const code = randomCode();
  const { data, error } = await admin.rpc("otp_issue", {
    p_email: email,
    p_code_hash: await hashCode(email, code),
    p_ip: ip,
  });
  if (error) return json({ error: "server_error" }, 500);
  if (!data.ok) return json({ error: data.reason, retry_after_s: data.retry_after_s }, 429);

  try {
    await sendEmail(email, code);
  } catch (e) {
    console.error("sendEmail failed", e);
    await admin.rpc("otp_discard", { p_id: data.id });
    return json({ error: "email_unavailable" }, 503);
  }

  return json({ sent: true, expires_in_s: data.expires_in_s, resend_in_s: data.resend_in_s });
}

async function verify(email: string, code: string): Promise<Response> {
  if (!/^\d{6}$/.test(code)) return json({ error: "wrong_code" }, 401);

  const { data, error } = await admin.rpc("otp_check", {
    p_email: email,
    p_code_hash: await hashCode(email, code),
  });
  if (error) return json({ error: "server_error" }, 500);
  if (!data.ok) return json({ error: data.reason, attempts_left: data.attempts_left }, 401);

  if (await isFull(email)) return json({ error: "full" }, 403);

  // The code is already consumed at this point. Mint the session: create the
  // user if new (an existing Google user with this address is the same
  // person, so they land in the same account), then exchange a one-shot
  // admin magic-link token for a session -- never emailed, used within ms.
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && created.error.code !== "email_exists") {
    if (/signups_closed/.test(created.error.message) || await isFull(email)) return json({ error: "full" }, 403);   // filled up since the check above
    console.error("createUser failed", created.error);
    return json({ error: "server_error" }, 500);
  }

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    console.error("generateLink failed", link.error);
    return json({ error: "server_error" }, 500);
  }

  const { data: v, error: vErr } = await admin.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token,
  });
  if (vErr || !v.session) {
    console.error("verifyOtp failed", vErr);
    return json({ error: "server_error" }, 500);
  }

  const s = v.session;
  return json({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    token_type: s.token_type,
    user: { id: s.user.id, email: s.user.email },
  });
}

// Uniform 000000-999999: reject the top sliver of the uint32 range that would
// otherwise bias low digits.
function randomCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

async function hashCode(email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("OTP_PEPPER")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${email}:${code}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
}

async function sendEmail(to: string, code: string): Promise<void> {
  const host = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
  const user = Deno.env.get("SMTP_USER") || Deno.env.get("GMAIL_USER");
  const pass = Deno.env.get("SMTP_PASS") || Deno.env.get("GMAIL_APP_PASSWORD");
  const from = Deno.env.get("SMTP_FROM") || user;
  const subject = `${code} is your ${APP_NAME} sign-in code`;
  const text = `Your ${APP_NAME} sign-in code is ${code}.\n\nIt expires in 3 minutes and works once. ` +
    `If you didn't ask for it, ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;background:#F4F1EA;padding:32px">
<div style="max-width:420px;margin:auto;background:#fff;border:1px solid #E5E3DB;border-radius:22px;padding:28px">
<p style="margin:0 0 8px;color:#5F5C56;font-size:14px">Your ${APP_NAME} sign-in code</p>
<p style="margin:0 0 20px;font-size:34px;font-weight:800;letter-spacing:8px;color:#181C1A">${code}</p>
<p style="margin:0;color:#5F5C56;font-size:13px">Expires in 3 minutes and works once. If you didn't ask for it, ignore this email.</p>
</div></div>`;

  // Port 465 (implicit TLS): Edge Functions block outbound 25 and 587.
  if (!user || !pass) throw new Error("SMTP_USER / SMTP_PASS not set");
  await nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
    auth: { user, pass },
  }).sendMail({ from: `${APP_NAME} <${from}>`, to, subject, text, html });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
