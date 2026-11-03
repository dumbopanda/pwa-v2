import Icon from "../Icon";
import { useMemo, useState } from "react";
import { APP_NAME, DEFAULT_CURRENCY } from "../config";
import { newUid, todayLocal } from "../lib/ids";
import { DEFAULT_CATEGORIES, SUGGESTED_ACCOUNTS, openingBalanceRows, validateAccounts, type AccountDraft } from "../lib/onboarding";
import { supabase } from "../supabase";

const CURRENCIES = [DEFAULT_CURRENCY, ...Intl.supportedValuesOf("currency").filter((c) => c !== DEFAULT_CURRENCY)];
const newDraft = (name = ""): AccountDraft =>
  ({ uid: newUid(), balanceUid: newUid(), name, currency: DEFAULT_CURRENCY, balance: "", owe: name === "Credit card" });

type Cat = { uid: string; name: string; on: boolean };

export default function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [accounts, setAccounts] = useState<AccountDraft[]>([]);
  const [cats, setCats] = useState<Cat[]>(() => DEFAULT_CATEGORIES.map((c) => ({ uid: newUid(), ...c })));
  const [custom, setCustom] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useMemo(() => validateAccounts(accounts), [accounts]);
  const unused = SUGGESTED_ACCOUNTS.filter((s) => !accounts.some((a) => a.name.trim().toLowerCase() === s.toLowerCase()));
  const edit = (uid: string, patch: Partial<AccountDraft>) =>
    setAccounts((xs) => xs.map((a) => (a.uid === uid ? { ...a, ...patch } : a)));

  function next() {
    setTried(true);
    if (!check.form && check.rows.every((r) => !r)) { setStep(2); setError(null); }
  }

  function addCustom(e: React.FormEvent) {
    e.preventDefault();
    const name = custom.trim().slice(0, 40);
    if (!name) return;
    const hit = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    setCats(hit ? cats.map((c) => (c === hit ? { ...c, on: true } : c)) : [...cats, { uid: newUid(), name, on: true }]);
    setCustom("");
  }

  // Every write is keyed on a client_uid made once above, so pressing the
  // button again after a failure re-sends the same rows instead of duplicating.
  async function finish() {
    const picked = cats.filter((c) => c.on);
    if (!picked.length) return setError("Pick at least one category.");
    setBusy(true); setError(null);
    try {
      const acc = await supabase.from("accounts")
        .upsert(accounts.map((a, i) => ({ client_uid: a.uid, name: a.name.trim(), currency: a.currency, sort_order: i })),
          { onConflict: "user_id,client_uid" })
        .select("id, client_uid");
      if (acc.error) throw acc.error;

      const cat = await supabase.from("categories")
        .upsert(picked.map((c, i) => ({ client_uid: c.uid, name: c.name, sort_order: i })), { onConflict: "user_id,client_uid" });
      if (cat.error) throw cat.error;

      const ids = new Map(acc.data.map((r) => [r.client_uid as string, r.id as string]));
      const rows = openingBalanceRows(accounts, ids, todayLocal());
      if (rows.length) {
        const push = await supabase.rpc("push_entries", { p_rows: rows });
        if (push.error) throw push.error;
      }

      const now = new Date().toISOString();
      const prof = await supabase.from("profiles")
        .update({ onboarded_at: now, consent_version: 1, consent_at: now }).eq("user_id", userId);
      if (prof.error) throw prof.error;
      onDone();
    } catch {
      setError("Couldn't save. Check your connection and try again — nothing will be added twice.");
      setBusy(false);
    }
  }

  return (
    <main className="screen stack" style={{ gap: "var(--sp-5)" }}>
      <div className="steps" aria-label={`Step ${step} of 2`}><span className="on" /><span className={step === 2 ? "on" : ""} /></div>

      {step === 1 && (
        <>
          <div className="stack" style={{ gap: "var(--sp-1)" }}>
            <h1>Where does your money sit?</h1>
            <p className="muted" style={{ margin: 0 }}>Add each account and what's in it today. You can change these later.</p>
          </div>

          {accounts.map((a, i) => {
            const err = tried ? check.rows[i] : null;
            return (
              <div key={a.uid} className="card stack">
                <div className="row">
                  <input className="field grow" placeholder="Account name" aria-label="Account name" maxLength={40}
                    value={a.name} onChange={(e) => edit(a.uid, { name: e.target.value })} />
                  <button className="btn icon" aria-label={`Remove ${a.name || "account"}`}
                    onClick={() => setAccounts((xs) => xs.filter((x) => x.uid !== a.uid))}><Icon name="close" /></button>
                </div>
                <div className="row">
                  <select className="field inset" style={{ width: 96 }} aria-label="Currency"
                    value={a.currency} onChange={(e) => edit(a.uid, { currency: e.target.value })}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input className="field inset grow" inputMode="decimal" placeholder="Balance today (optional)"
                    aria-label="Balance today" value={a.balance} onChange={(e) => edit(a.uid, { balance: e.target.value })} />
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={a.owe} onChange={(e) => edit(a.uid, { owe: e.target.checked })} />
                  I owe this amount (like a credit card bill)
                </label>
                {err && <p className="error">{err}</p>}
              </div>
            );
          })}

          <div className="chips">
            {unused.map((s) => <button key={s} className="chip" onClick={() => setAccounts((xs) => [...xs, newDraft(s)])}>＋ {s}</button>)}
            <button className="chip" onClick={() => setAccounts((xs) => [...xs, newDraft()])}>＋ Other</button>
          </div>

          {tried && check.form && <p className="error">{check.form}</p>}
          <button className="btn primary" onClick={next}>Next</button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="stack" style={{ gap: "var(--sp-1)" }}>
            <h1>What do you spend on?</h1>
            <p className="muted" style={{ margin: 0 }}>Tap to pick or drop. Add your own if something's missing.</p>
          </div>

          <div className="chips">
            {cats.map((c) => (
              <button key={c.uid} className="chip" aria-pressed={c.on}
                onClick={() => setCats((xs) => xs.map((x) => (x.uid === c.uid ? { ...x, on: !x.on } : x)))}>{c.name}</button>
            ))}
          </div>
          <form className="row" onSubmit={addCustom}>
            <input className="field grow" placeholder="Add a category" aria-label="Add a category" maxLength={40}
              value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn">Add</button>
          </form>

          <div className="notice">
            Your entries are private to your account. When you use quick log, only the words you type and your
            account and category names are sent to the AI to read them — never your balances or other entries.
            You can export or delete everything from Settings.
          </div>

          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" onClick={finish} disabled={busy}>{busy ? "Saving…" : `Start using ${APP_NAME}`}</button>
          <button className="btn quiet" onClick={() => setStep(1)} disabled={busy}>Back</button>
        </>
      )}
    </main>
  );
}
