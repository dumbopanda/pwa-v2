import Icon from "../Icon";
import { useMemo, useState } from "react";
import { APP_NAME, DEFAULT_CURRENCY, currencyList } from "../config";
import { newUid, todayLocal } from "../lib/ids";
import { BalanceDate, useBalanceDate } from "../components";
import { DEFAULT_CATEGORIES, SUGGESTED_ACCOUNTS, openingBalanceRows, validateAccounts, type AccountDraft } from "../lib/onboarding";
import { supabase } from "../supabase";
import { useScrollTop } from "../lib/hooks";

const symbol = (cur: string) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? cur; }
  catch { return cur; }
};

// What the app does, one idea per screen. Pictures are decorative CSS.
const INTRO = [
  { title: "Say it once.", body: "Speak or type “chai 20”. It's logged.", art: "say" },
  { title: "Close each day.", body: "Tap Close when every payment is in. No gaps.", art: "days" },
  { title: "See where it went.", body: "Spending by category, month by month.", art: "bars" },
] as const;

function IntroArt({ kind }: { kind: (typeof INTRO)[number]["art"] }) {
  if (kind === "say") return (
    <div className="iart" aria-hidden="true">
      <div className="say">“Chai 20, auto 80 from UPI”</div>
      <div className="card rows"><div className="r"><span>Chai</span><b className="amt">₹20</b></div><div className="r"><span>Auto</span><b className="amt">₹80</b></div></div>
    </div>
  );
  if (kind === "days") return (
    <div className="iart" aria-hidden="true">
      <div className="daysrow">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className={i < 5 ? "closed" : i === 5 ? "open" : ""}>{i < 5 ? <Icon name="check" size={16} /> : d}</span>)}</div>
      <div className="card"><b>Saturday</b><span className="muted small"> · open</span></div>
    </div>
  );
  return (
    <div className="iart" aria-hidden="true">
      <div className="card barsart">{[["Food", 78], ["Transport", 46], ["Bills", 30]].map(([n, w]) => <div key={n} className="r"><span>{n}</span><i style={{ width: `${w}%` }} /></div>)}</div>
    </div>
  );
}
const newDraft = (name = ""): AccountDraft =>
  ({ uid: newUid(), balanceUid: newUid(), name, currency: DEFAULT_CURRENCY, balance: "", owe: name === "Credit card" });

type Cat = { uid: string; name: string; on: boolean };

export default function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [slide, setSlide] = useState(0);
  useScrollTop(step, slide);
  const [accounts, setAccounts] = useState<AccountDraft[]>([]);
  const [cats, setCats] = useState<Cat[]>(() => DEFAULT_CATEGORIES.map((c) => ({ uid: newUid(), ...c })));
  const [custom, setCustom] = useState("");
  const [tried, setTried] = useState(false);
  const bd = useBalanceDate(todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useMemo(() => validateAccounts(accounts), [accounts]);
  const hasBalance = accounts.some((a) => a.balance.trim() && a.balance.trim() !== "0");
  const unused = SUGGESTED_ACCOUNTS.filter((s) => !accounts.some((a) => a.name.trim().toLowerCase() === s.toLowerCase()));
  const edit = (uid: string, patch: Partial<AccountDraft>) =>
    setAccounts((xs) => xs.map((a) => (a.uid === uid ? { ...a, ...patch } : a)));

  function next() {
    setTried(true);
    if (!check.form && check.rows.every((r) => !r) && !(hasBalance && bd.needsConfirm)) { setStep(2); setError(null); }
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
      const rows = openingBalanceRows(accounts, ids, bd.value);
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

  const pageFoot = (label: string, onClick: () => void, extra?: React.ReactNode) => (
    <div className="pagefoot stack" style={{ gap: "var(--sp-2)" }}>
      <button className="btn primary" style={{ width: "100%" }} onClick={onClick}>{label}</button>
      {extra}
    </div>
  );

  if (step === 0) {
    const last = slide === INTRO.length - 1;
    return (
      <main className="screen onb intro">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="dots" aria-label={`Screen ${slide + 1} of ${INTRO.length}`}>{INTRO.map((_, i) => <span key={i} className={i === slide ? "on" : ""} />)}</div>
          <button className="btn quiet" onClick={() => setStep(1)}>Skip</button>
        </div>
        <IntroArt kind={INTRO[slide].art} />
        <div className="stack" style={{ gap: "var(--sp-2)" }}>
          <h1 className="bigtitle">{INTRO[slide].title}</h1>
          <p className="muted lead">{INTRO[slide].body}</p>
        </div>
        {pageFoot(last ? "Get started" : "Next", () => (last ? setStep(1) : setSlide(slide + 1)),
          slide > 0 && <button className="btn quiet" onClick={() => setSlide(slide - 1)}>Back</button>)}
      </main>
    );
  }

  return (
    <main className="screen stack onb" style={{ gap: "var(--sp-5)" }}>
      <div className="steps" aria-label={`Step ${step} of 2`}><span className="on" /><span className={step === 2 ? "on" : ""} /></div>

      {step === 1 && (
        <>
          <div className="stack" style={{ gap: "var(--sp-1)" }}>
            <span className="caps">Step 1 of 2</span>
            <h1 className="bigtitle">Where does your money sit?</h1>
            <p className="muted lead">Add your accounts. You can change them later.</p>
          </div>

          {accounts.map((a, i) => {
            const err = tried ? check.rows[i] : null;
            return (
              <div key={a.uid} className="card onbacct">
                <div className="acchead">
                  <span className={`ttile acc${i % 4}`} aria-hidden="true">{a.name.trim().charAt(0).toUpperCase() || "?"}</span>
                  <input className="bare grow" placeholder="Account name" aria-label="Account name" maxLength={40}
                    value={a.name} onChange={(e) => edit(a.uid, { name: e.target.value })} />
                  <button className="iconbtn flat sm" aria-label={`Remove ${a.name || "account"}`}
                    onClick={() => setAccounts((xs) => xs.filter((x) => x.uid !== a.uid))}><Icon name="close" size={18} /></button>
                </div>
                <div className="amountrow">
                  <span className="sym" aria-hidden="true">{symbol(a.currency)}</span>
                  <input className="amountin grow" inputMode="decimal" placeholder="0" aria-label={a.owe ? "Amount owed today" : "Balance today"}
                    value={a.balance} onChange={(e) => edit(a.uid, { balance: e.target.value })} />
                  <label className="curpick">
                    <span>{a.currency}</span><Icon name="down" size={14} />
                    <select aria-label="Currency" value={a.currency} onChange={(e) => edit(a.uid, { currency: e.target.value })}>
                      {currencyList(a.currency).map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
                <div className="seg quiet" role="group" aria-label={`${a.name || "Account"}: balance type`}>
                  <button type="button" aria-pressed={!a.owe} onClick={() => edit(a.uid, { owe: false })}>I have</button>
                  <button type="button" aria-pressed={a.owe} onClick={() => edit(a.uid, { owe: true })}>I owe</button>
                </div>
                {err && <p className="error">{err}</p>}
              </div>
            );
          })}

          <div className="chips">
            {unused.map((s) => <button key={s} className="fchip add" onClick={() => setAccounts((xs) => [...xs, newDraft(s)])}><Icon name="plus" size={16} />{s}</button>)}
            <button className="fchip add" onClick={() => setAccounts((xs) => [...xs, newDraft()])}><Icon name="plus" size={16} />Other</button>
          </div>

          {hasBalance && <section className="card"><BalanceDate today={todayLocal()} bd={bd} /></section>}
          {tried && check.form && <p className="error">{check.form}</p>}
          {tried && hasBalance && bd.needsConfirm && <p className="error">Choose Use today or Keep the earlier date first.</p>}
          {pageFoot("Next", next)}
        </>
      )}

      {step === 2 && (
        <>
          <div className="stack" style={{ gap: "var(--sp-1)" }}>
            <span className="caps">Step 2 of 2</span>
            <h1 className="bigtitle">What do you spend on?</h1>
            <p className="muted lead">Pick what fits. Add your own.</p>
          </div>

          <div className="chips">
            {cats.map((c) => (
              <button key={c.uid} className="fchip big" aria-pressed={c.on}
                onClick={() => setCats((xs) => xs.map((x) => (x.uid === c.uid ? { ...x, on: !x.on } : x)))}>{c.on && <Icon name="check" size={14} />}{c.name}</button>
            ))}
          </div>
          <form className="row" onSubmit={addCustom}>
            <input className="field grow" placeholder="Add a category" aria-label="Add a category" maxLength={40}
              value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn">Add</button>
          </form>

          <div className="notice privacy">
            <b className="row"><Icon name="lock" size={16} />Your data stays yours</b>
            <ul>
              <li>Private to your account.</li>
              <li>Most entries are read on your phone. When AI helps, it sees only your words and category names, and keeps nothing.</li>
              <li>We keep what you typed (never audio) to improve reading. Export or delete it all in Settings.</li>
            </ul>
            <a href="/privacy.html" target="_blank" rel="noopener">Privacy policy</a>
          </div>

          {error && <p className="error" role="alert">{error}</p>}
          <div className="pagefoot stack" style={{ gap: "var(--sp-2)" }}>
            <button className="btn primary" style={{ width: "100%" }} onClick={finish} disabled={busy}>{busy ? "Saving…" : `Start using ${APP_NAME}`}</button>
            <button className="btn quiet" onClick={() => setStep(1)} disabled={busy}>Back</button>
          </div>
        </>
      )}
    </main>
  );
}
