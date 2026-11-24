import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "../config";
import { emailOtp, supabase } from "../supabase";
import { useScrollTop } from "../lib/hooks";

/** Version of /privacy.html the person agrees to. Bump when the page changes. */
export const POLICY_VERSION = 1;
const RESEND_AFTER_S = 120; // a code lives 3 min; "ask again" shows for the last minute (matches otp_issue, 0023)
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

/** "Spend Roll": the last word sits on a lime highlight. */
const title = (name: string) => { const w = name.split(" "); return <>{w.slice(0, -1).join(" ")} <mark>{w[w.length - 1]}</mark></>; };

const PAY = 30000;
const DEMO = [["Chai", "Food", 20, 0], ["Auto", "Transport", 80, 1], ["Lunch", "Food", 180, 2], ["Groceries", "Home", 640, 3], ["Rent", "Home", 12000, 0]] as const;
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

/** Try-it demo: a pay balance that drops as payments go in. Plays on its own; a tap adds the next one. */
function Demo() {
  const [n, setN] = useState(2);
  const [touched, setTouched] = useState(false);
  const next = () => setN((x) => (x >= DEMO.length ? 1 : x + 1));
  useEffect(() => {
    if (touched || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(next, 2200);
    return () => clearInterval(t);
  }, [touched]);
  const spent = DEMO.slice(0, n).reduce((sum, d) => sum + d[2], 0);
  return (
    <button type="button" className="hero demo" aria-label="Try it: add a payment" onClick={() => { setTouched(true); next(); }}>
      <span className="hkey"><span>Left from your pay</span><span className="hchip">{inr(PAY)} pay</span></span>
      <span className="hval">{inr(PAY - spent)}</span>
      <span className="planbar"><span style={{ width: `${Math.max(2, (spent / PAY) * 100)}%` }} /></span>
      <span className="demo-rows">
        {DEMO.slice(Math.max(0, n - 3), n).reverse().map(([name, cat, amt, tone]) => (
          <span className="demo-row" key={name}>
            <span className={`ttile acc${tone}`}>{name.charAt(0)}</span>
            <span className="demo-name">{name}<small>{cat}</small></span>
            <b>-{inr(amt)}</b>
          </span>
        ))}
      </span>
      <span className="demo-hint">Tap to add a payment</span>
    </button>
  );
}

export default function SignIn() {
  const [mode, setMode] = useState<"start" | "code">("start");
  // Everyone lands on sign up; returning people switch at the bottom.
  const [intent, setIntent] = useState<"up" | "in">("up");
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
  // Continuing counts as agreeing; the consent is logged after sign-in.
  function agreed(): boolean { markConsent(); return true; }

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

  // Runs by itself when the sixth digit lands: no Log in button.
  const verifying = useRef(false);
  async function verify(c: string) {
    if (verifying.current) return;
    verifying.current = true; setBusy(true); setError(null);
    const r = await emailOtp({ action: "verify", email: email.trim().toLowerCase(), code: c });
    if (r.ok && r.access_token && r.refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
      if (!error) return; // App switches screens on the auth event
    }
    verifying.current = false; setBusy(false);
    setCode("");
    setError(otpMessage(r));
  }

  if (mode === "code") {
    // Nothing moves: the ask-again line always takes its space, and shows after 2 minutes.
    const canResend = now - sentAt >= RESEND_AFTER_S * 1000;
    return (
      <main className="screen signin top">
        <div className="stack" style={{ gap: "var(--sp-2)" }}>
          <h1 className="signin-title">Check your email</h1>
          <p className="muted" style={{ margin: 0 }}>We sent a 6-digit code to <b>{email.trim().toLowerCase()}</b>.</p>
        </div>
        <div className="stack" style={{ gap: "var(--sp-4)" }}>
          {/* One real input (paste and SMS/email autofill work), drawn as 6 boxes. */}
          <div className="otp">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={i === Math.min(code.length, 5) ? "on" : ""}>{code[i] ?? ""}</span>
            ))}
            <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
              value={code} onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v); setError(null);
                if (v.length === 6) verify(v);
              }} />
          </div>
          <p className="error slot" role="alert">{error}</p>
        <p className="muted small" style={{ margin: 0, textAlign: "center" }}>
          By continuing, I agree to the <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: "inherit" }}>privacy policy and terms</a>
        </p>
          <p className="muted small slot" style={{ margin: 0, textAlign: "center", visibility: canResend ? "visible" : "hidden" }}>
            Didn't get it?{" "}
            <button type="button" className="linkbtn" disabled={busy || !canResend} onClick={() => sendCode()}>Request another code</button>
          </p>
          <button type="button" className="btn quiet" onClick={() => { setMode("start"); setCode(""); setError(null); }}>Use a different email</button>
        </div>
      </main>
    );
  }

  const up = intent === "up";
  return (
    <main className="screen signin">
      <div className="stack" style={{ gap: "var(--sp-2)" }}>
        <h1 className="signin-title">{title(APP_NAME)}</h1>
        <p className="signin-tag">Track where your pay went.</p>
        <Demo />
      </div>

      <div className="stack">
        <button className="btn dark" onClick={google} disabled={busy}><GoogleLogo /> {up ? "Sign up" : "Sign in"} with Google</button>
        <div className="divider">or</div>
        <form className="stack" onSubmit={sendCode}>
          <label className="lbl" htmlFor="email" style={{ margin: 0 }}>Email</label>
          <input id="email" className="field" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" disabled={busy}>{up ? "Sign up" : "Sign in"} with email</button>
        </form>
        <p className="error slot" role="alert">{error}</p>
        <p className="muted small" style={{ margin: 0, textAlign: "center" }}>
          {up ? "Already have an account?" : "New here?"}{" "}
          <button type="button" className="linkbtn" onClick={() => { setIntent(up ? "in" : "up"); setError(null); }}>{up ? "Sign in" : "Sign up"}</button>
        </p>
      </div>
    </main>
  );
}
