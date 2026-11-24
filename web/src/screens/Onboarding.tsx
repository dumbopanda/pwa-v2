import Icon from "../Icon";
import { useEffect, useMemo, useState } from "react";
import { APP_NAME, DEFAULT_CURRENCY, currencyList } from "../config";
import { newUid, todayLocal } from "../lib/ids";
import { BalanceDate, ProfileFields, useBalanceDate } from "../components";
import { Avatar, AvatarGrid } from "../lib/avatars";
import { formToPatch, type ProfForm, type ProfPatch } from "../lib/profile";
import { DEFAULT_CATEGORIES, SUGGESTED_ACCOUNTS, openingBalanceRows, validateAccounts, type AccountDraft } from "../lib/onboarding";
import { supabase } from "../supabase";
import { useScrollTop } from "../lib/hooks";
import { logEvent } from "../lib/actions";

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

const tx = (n: string, meta: string, amt: string, tone: number) => (
  <div className="txn" key={n}>
    <span className={`ttile acc${tone}`}>{n.charAt(0)}</span>
    <div className="tbody"><div className="tline1"><span className="tname">{n}</span><span className="tamt out">{amt}</span></div><span className="tmeta">{meta}</span></div>
  </div>
);

// Small copies of the real screens (History, Close day, Stats), with plausible numbers.
function IntroArt({ kind }: { kind: (typeof INTRO)[number]["art"] }) {
  if (kind === "say") return (
    <div className="iart" aria-hidden="true">
      <div className="say">“Chai 20, auto 80 from UPI”</div>
      <div className="daycard">
        <div className="dayhead2 today"><div className="dname"><b>Today</b></div><span className="dnet out">₹100</span></div>
        <div className="txns">{tx("Chai", "UPI bank · Food & dining", "₹20", 0)}{tx("Auto", "UPI bank · Transport", "₹80", 0)}</div>
      </div>
    </div>
  );
  if (kind === "days") return (
    <div className="iart" aria-hidden="true">
      <div className="daycard">
        <div className="dayhead2"><div className="dname2"><b>Saturday<small>22 Nov</small></b></div><span className="status open">Open</span></div>
        <div className="txns">{tx("Lunch", "Cash · Food & dining", "₹180", 2)}</div>
        <div className="dayfoot"><span className="lockline">All payments in?</span><span className="btn primary">Close day</span></div>
      </div>
      <div className="daycard collapsed">
        <div className="dayhead2"><div className="dname2"><b>Friday<small>21 Nov</small></b></div><span className="status closed"><Icon name="lock" size={12} />Closed</span></div>
      </div>
    </div>
  );
  return (
    <div className="iart" aria-hidden="true">
      <div className="card panel">
        <div className="phead"><span className="ptitle">Where it went</span><span className="pnote">November</span></div>
        <div className="brk">
          {[["Food & dining", "₹6,240", 78], ["Transport", "₹3,680", 46], ["Bills & utilities", "₹2,400", 30]].map(([n, v, w], i) => (
            <div key={n} className="brow">
              <span className="brank">{i + 1}</span>
              <div className="btop"><span className="bname">{n}</span><b className="bval">{v}</b></div>
              <div className="bbar"><span className={i === 0 ? "strong" : ""} style={{ width: `${w}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const newDraft = (name = ""): AccountDraft =>
  ({ uid: newUid(), balanceUid: newUid(), name, currency: DEFAULT_CURRENCY, balance: "", owe: name === "Credit card" });

type Cat = { uid: string; name: string; on: boolean };

export default function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  // Step 1, About you: optional. `about` is what gets saved at the end; null when skipped.
  const [pf, setPf] = useState<ProfForm>({ display_name: "", age: "", location: "", occupation: "" });
  const [avatar, setAvatar] = useState<string | null>(null);
  const [about, setAbout] = useState<ProfPatch | null>(null);
  const [aboutErr, setAboutErr] = useState<string | null>(null);
  // A Google sign-in already carries a name: start from it.
  useEffect(() => {
    supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle()
      .then((r) => { const n = r.data?.display_name; if (n) setPf((f) => (f.display_name ? f : { ...f, display_name: n })); }, () => undefined);
  }, [userId]);
  const [slide, setSlide] = useState(0);
  useScrollTop(step, slide);
  // Where people stop: one event per screen shown (step 0 = intro slides, with the slide number).
  useEffect(() => logEvent("onb_step", { step, slide: step === 0 ? slide : 0 }), [step, slide]);
  const [accounts, setAccounts] = useState<AccountDraft[]>([]);
  const [cats, setCats] = useState<Cat[]>(() => DEFAULT_CATEGORIES.map((c) => ({ uid: newUid(), ...c })));
  const [custom, setCustom] = useState("");
  const [tried, setTried] = useState(false);
  const bd = useBalanceDate(todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new account scrolls into view and takes focus: the name if empty, else the balance.
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => {
    if (!added) return;
    const card = document.getElementById(`acct-${added}`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
    card?.querySelector<HTMLInputElement>("input.bare:placeholder-shown, input.amountin")?.focus({ preventScroll: true });
    setAdded(null);
  }, [added]);
  const addAccount = (name = "") => { const d = newDraft(name); setAccounts((xs) => [...xs, d]); setAdded(d.uid); };

  const check = useMemo(() => validateAccounts(accounts), [accounts]);
  const hasBalance = accounts.some((a) => a.balance.trim() && a.balance.trim() !== "0");
  const unused = SUGGESTED_ACCOUNTS.filter((s) => !accounts.some((a) => a.name.trim().toLowerCase() === s.toLowerCase()));
  const edit = (uid: string, patch: Partial<AccountDraft>) =>
    setAccounts((xs) => xs.map((a) => (a.uid === uid ? { ...a, ...patch } : a)));

  function next() {
    setTried(true);
    if (!check.form && check.rows.every((r) => !r) && !(hasBalance && bd.needsConfirm)) { setStep(3); setError(null); }
    else logEvent("onb_blocked", { step: 2 });   // pressed Next but the form said no
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
        .update({ ...(about ?? {}), onboarded_at: now, consent_version: 1, consent_at: now }).eq("user_id", userId);
      if (prof.error) throw prof.error;
      logEvent("onb_done");
      onDone();
    } catch {
      logEvent("onb_save_failed");
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
      <div className="steps" aria-label={`Step ${step} of 3`}><span className="on" /><span className={step >= 2 ? "on" : ""} /><span className={step === 3 ? "on" : ""} /></div>

      {step === 1 && (
        <>
          <div className="stack" style={{ gap: "var(--sp-1)" }}>
            <span className="caps">Step 1 of 3</span>
            <h1 className="bigtitle">Make it yours.</h1>
            <p className="muted lead">Pick an icon and add your name. All optional.</p>
          </div>
          <div className="row" style={{ justifyContent: "center" }}><Avatar avatar={avatar} name={pf.display_name} size={96} /></div>
          <AvatarGrid value={avatar} onPick={setAvatar} />
          <section className="card stack"><ProfileFields f={pf} set={(p) => setPf({ ...pf, ...p })} /></section>
          {aboutErr && <p className="error" role="alert">{aboutErr}</p>}
          {pageFoot("Next", () => {
            const r = formToPatch(pf);
            if ("error" in r) return setAboutErr(r.error);
            setAboutErr(null); setAbout({ ...r.patch, avatar }); setStep(2);
          }, <button className="btn quiet" onClick={() => { setAbout(null); setAboutErr(null); setStep(2); }}>Skip</button>)}
        </>
      )}

      {step === 2 && (
        <>
          <div className="stack" style={{ gap: "var(--sp-1)" }}>
            <span className="caps">Step 2 of 3</span>
            <h1 className="bigtitle">Where does your money sit?</h1>
            <p className="muted lead">Add your accounts. You can change them later.</p>
          </div>

          {accounts.map((a, i) => {
            const err = tried ? check.rows[i] : null;
            return (
              <div key={a.uid} id={`acct-${a.uid}`} className="card onbacct">
                <div className="acchead">
                  <span className={`ttile acc${i % 4}`} aria-hidden="true">{a.name.trim().charAt(0).toUpperCase() || "?"}</span>
                  <label className="namefield grow">
                    <input className="bare" placeholder="Account name" aria-label="Account name" maxLength={40}
                      value={a.name} onChange={(e) => edit(a.uid, { name: e.target.value })} />
                    <Icon name="edit" size={16} />
                  </label>
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

          {unused.length > 0 && (
            <div className="stack" style={{ gap: "var(--sp-2)" }}>
              <span className="caps">Quick add</span>
              <div className="chips">
                {unused.map((s) => <button key={s} className="fchip add" onClick={() => addAccount(s)}><Icon name="plus" size={16} />{s}</button>)}
              </div>
            </div>
          )}
          <button className="addown" onClick={() => addAccount()}><Icon name="plus" size={18} />Add your own account</button>

          {hasBalance && <section className="card"><BalanceDate today={todayLocal()} bd={bd} /></section>}
          {tried && check.form && <p className="error">{check.form}</p>}
          {tried && hasBalance && bd.needsConfirm && <p className="error">Choose Use today or Keep the earlier date first.</p>}
          {pageFoot("Next", next)}
        </>
      )}

      {step === 3 && (
        <>
          <div className="stack" style={{ gap: "var(--sp-1)" }}>
            <span className="caps">Step 3 of 3</span>
            <h1 className="bigtitle">What do you spend on?</h1>
            <p className="muted lead">Pick what fits. Add your own.</p>
          </div>

          <div className="chips">
            {cats.map((c) => (
              <button key={c.uid} className="fchip big" aria-pressed={c.on}
                onClick={() => setCats((xs) => xs.map((x) => (x.uid === c.uid ? { ...x, on: !x.on } : x)))}>{c.on && <Icon name="check" size={14} />}{c.name}</button>
            ))}
          </div>
          <form className="addowncat" onSubmit={addCustom}>
            <span className="caps">Your own</span>
            <div className="row">
              <input className="field grow" placeholder="Category name" aria-label="Category name" maxLength={40}
                value={custom} onChange={(e) => setCustom(e.target.value)} />
              <button className="btn" disabled={!custom.trim()}>Add</button>
            </div>
          </form>

          <div className="notice privacy">
            <b className="row"><Icon name="lock" size={16} />Your data stays yours</b>
            <ul>
              <li>Private to your account.</li>
              <li>Most entries are read on your phone. When AI helps, it sees only your words and category names, and keeps nothing.</li>
              <li>We keep what you typed (never audio) to improve reading. Export or delete it all in your Profile.</li>
            </ul>
            <a href="/privacy.html" target="_blank" rel="noopener">Privacy policy</a>
          </div>

          {error && <p className="error" role="alert">{error}</p>}
          <div className="pagefoot stack" style={{ gap: "var(--sp-2)" }}>
            <button className="btn primary" style={{ width: "100%" }} onClick={finish} disabled={busy}>{busy ? "Saving…" : `Start using ${APP_NAME}`}</button>
            <button className="btn quiet" onClick={() => setStep(2)} disabled={busy}>Back</button>
          </div>
        </>
      )}
    </main>
  );
}
