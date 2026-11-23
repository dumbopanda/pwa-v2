import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "../config";
import { emailOtp, supabase } from "../supabase";
import { useScrollTop } from "../lib/hooks";

/** Version of /privacy.html the person agrees to. Bump when the page changes. */
export const POLICY_VERSION = 1;
const CODE_LIFE_S = 180, RESEND_AFTER_S = 150;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
export const CONSENT_KEY = "consent_pending";
/** Kept until App logs it after sign-in (survives the Google redirect). */
function markConsent() {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: POLICY_VERSION, agreed_at: new Date().toISOString() })); } catch { /* ignore */ }
}

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

const GoogleLogo = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** Decorative: what the app does, in one picture. */
const Hero = () => (
  <div className="signin-hero" aria-hidden="true">
    <div className="say">"Chai 20, auto 80 from UPI"</div>
    <div className="card rows">
      <div className="caps">Today</div>
      <div className="r"><span>Chai</span><b className="amt">₹20</b></div>
      <div className="r"><span>Auto</span><b className="amt">₹80</b></div>
    </div>
  </div>
);

export default function SignIn() {
  const [mode, setMode] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  useScrollTop(mode);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (mode !== "code") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [mode]);
  // Read straight from the boxes, not React state: a browser that restores a
  // ticked box after reload would otherwise leave the buttons blocked.
  const agreeRef = useRef<HTMLInputElement>(null);

  function agreed(): boolean {
    if (agreeRef.current?.checked) { markConsent(); return true; }
    setError("Tick “I agree to the privacy policy and terms” first.");
    agreeRef.current?.focus();
    return false;
  }

  async function google() {
    setError(null);
    if (!agreed()) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) { setError("Google sign-in isn't available right now."); setBusy(false); }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const addr = email.trim().toLowerCase();
    if (!RE_EMAIL.test(addr)) return setError("That email doesn't look right.");
    if (!agreed()) return;
    // Show the code screen at once; the email takes a few seconds to send.
    const was = mode, at = sentAt;
    setMode("code"); setSentAt(Date.now()); setNow(Date.now()); setCode("");
    setBusy(true);
    const r = await emailOtp({ action: "send", email: addr });
    setBusy(false);
    if (r.ok) return;
    setError(otpMessage(r));
    if (r.error === "cooldown") { if (was === "code") setSentAt(at); return; }
    if (was === "start") setMode("start"); else setSentAt(at);
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

  if (mode === "code") {
    const left = Math.max(0, Math.ceil((sentAt + CODE_LIFE_S * 1000 - now) / 1000));
    const canResend = left <= CODE_LIFE_S - RESEND_AFTER_S; // matches otp_issue (0022)
    return (
      <main className="screen signin top">
        <div className="stack" style={{ gap: "var(--sp-2)" }}>
          <h1 className="signin-title">Check your email</h1>
          <p className="muted" style={{ margin: 0 }}>We sent a 6-digit code to <b>{email.trim().toLowerCase()}</b>. Enter it below.</p>
        </div>
        <form className="stack" onSubmit={verify} style={{ gap: "var(--sp-4)" }}>
          {/* One real input (paste and SMS/email autofill work), drawn as 6 boxes. */}
          <div className="otp">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={i === Math.min(code.length, 5) ? "on" : ""}>{code[i] ?? ""}</span>
            ))}
            <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
              value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }} />
          </div>
          <p className="otp-timer" aria-live="polite">
            {left > 0 ? <>Code expires in <b>{mmss(left)}</b></> : "Code expired"}
          </p>
          <p className="muted small" style={{ margin: 0, textAlign: "center" }}>
            Didn't get it?{" "}
            <button type="button" className="linkbtn" disabled={busy || !canResend} onClick={() => sendCode()}>
              {canResend ? "Send a new code" : `Send a new code in ${mmss(left - (CODE_LIFE_S - RESEND_AFTER_S))}`}
            </button>
          </p>
          <button className="btn primary" disabled={busy || code.length < 6 || left === 0}>Log in</button>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="button" className="btn quiet" onClick={() => { setMode("start"); setCode(""); setError(null); }}>Use a different email</button>
        </form>
      </main>
    );
  }

  return (
    <main className="screen signin">
      <div className="stack" style={{ gap: "var(--sp-2)" }}>
        <h1 className="signin-title">{APP_NAME}</h1>
        <p className="muted" style={{ margin: 0, fontSize: "var(--fs-lg)" }}>Say it once. Know where every rupee went.</p>
        <Hero />
      </div>

      <div className="stack">
        <div className="stack" style={{ gap: 0 }}>
          <label className="toggle">
            <input ref={agreeRef} type="checkbox" autoComplete="off" onChange={() => setError(null)} />
            <span>I agree to the <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: "inherit" }}>privacy policy and terms</a></span>
          </label>
        </div>
        <button className="btn dark" onClick={google} disabled={busy}><GoogleLogo /> Continue with Google</button>
        <div className="divider">or</div>
        <form className="stack" onSubmit={sendCode}>
          <label className="lbl" htmlFor="email" style={{ margin: 0 }}>Email</label>
          <input id="email" className="field" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={busy}>Log in with email</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
