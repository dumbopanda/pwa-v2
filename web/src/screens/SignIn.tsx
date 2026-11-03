import { useState } from "react";
import { APP_NAME } from "../config";
import { emailOtp, supabase } from "../supabase";

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function otpMessage(r: { error?: string; retry_after_s?: number; attempts_left?: number }): string {
  const wait = r.retry_after_s ? ` Try again in ${Math.ceil(r.retry_after_s / 60)} min.` : "";
  switch (r.error) {
    case "cooldown": return `A code was sent a moment ago. Check your inbox and spam folder.${wait}`;
    case "too_many": return `Too many codes for now.${wait}`;
    case "email_unavailable": return "Couldn't send the email right now. Try Google, or try again soon.";
    case "invalid_email": return "That email doesn't look right.";
    case "wrong_code": return r.attempts_left != null ? `Wrong code. ${r.attempts_left} tries left.` : "Wrong code.";
    case "locked": return "Too many wrong tries. Ask for a new code.";
    case "expired": return "That code expired. Ask for a new one.";
    case "no_code": return "No active code. Ask for a new one.";
    case "network": return "Couldn't reach the server. Check your connection.";
    default: return "Something failed on our side. Try again.";
  }
}

export default function SignIn() {
  const [mode, setMode] = useState<"start" | "email" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) { setError("Google sign-in isn't available right now."); setBusy(false); }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!RE_EMAIL.test(addr)) return setError("That email doesn't look right.");
    setBusy(true); setError(null);
    const r = await emailOtp({ action: "send", email: addr });
    setBusy(false);
    if (r.ok || r.error === "cooldown") { setMode("code"); if (!r.ok) setError(otpMessage(r)); }
    else setError(otpMessage(r));
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("The code is 6 digits.");
    setBusy(true); setError(null);
    const r = await emailOtp({ action: "verify", email: email.trim().toLowerCase(), code });
    if (r.ok && r.access_token && r.refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
      if (!error) return; // App switches screens on the auth event
    }
    setBusy(false);
    setError(otpMessage(r));
  }

  return (
    <main className="screen stack" style={{ minHeight: "100dvh", justifyContent: "center", gap: "var(--sp-6)" }}>
      <div className="stack" style={{ gap: "var(--sp-2)" }}>
        <h1>{APP_NAME}</h1>
        <p className="muted" style={{ margin: 0 }}>Say it once. Know where every rupee went.</p>
      </div>

      {mode === "start" && (
        <div className="stack">
          <button className="btn dark" onClick={google} disabled={busy}>Continue with Google</button>
          <div className="divider">or</div>
          <button className="btn" onClick={() => { setMode("email"); setError(null); }} disabled={busy}>Use an email code</button>
        </div>
      )}

      {mode === "email" && (
        <form className="stack" onSubmit={sendCode}>
          <label className="lbl" htmlFor="email">Email</label>
          <input id="email" className="field" type="email" inputMode="email" autoComplete="email" autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" disabled={busy}>Send me a code</button>
          <button type="button" className="btn quiet" onClick={() => { setMode("start"); setError(null); }}>Back</button>
        </form>
      )}

      {mode === "code" && (
        <form className="stack" onSubmit={verify}>
          <p className="muted small" style={{ margin: 0 }}>We sent a 6-digit code to {email.trim().toLowerCase()}. It works for 5 minutes.</p>
          <label className="lbl" htmlFor="code">Code</label>
          <input id="code" className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button className="btn primary" disabled={busy}>Sign in</button>
          <button type="button" className="btn quiet" onClick={() => { setMode("email"); setCode(""); setError(null); }}>Use a different email</button>
        </form>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
