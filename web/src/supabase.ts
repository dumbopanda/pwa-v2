import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
if (!url || !key) throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see web/.env.example)");

export const supabase = createClient(url, key, { auth: { flowType: "pkce" } });

type OtpReply = {
  ok: boolean; error?: string; retry_after_s?: number; attempts_left?: number;
  access_token?: string; refresh_token?: string;
};

/** The email-otp Edge Function: { action: "send" | "verify", email, code? }. */
export async function emailOtp(body: { action: "send" | "verify"; email: string; code?: string }): Promise<OtpReply> {
  try {
    const r = await fetch(`${url}/functions/v1/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key! },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, ...(await r.json().catch(() => ({}))) };
  } catch {
    return { ok: false, error: "network" };
  }
}
