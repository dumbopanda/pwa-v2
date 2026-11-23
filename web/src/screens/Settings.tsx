import Icon from "../Icon";
import { useEffect, useState } from "react";
import { addAccount, addCategory, deleteMyAccount, exportCsv, updateAccount, updateCategory } from "../lib/actions";
import { BalanceDate, toast, useAction, useBalanceDate } from "../components";
import { APP_NAME, DEFAULT_CURRENCY, currencyList } from "../config";
import { useLedger, useToday } from "../lib/hooks";
import { supabase } from "../supabase";
import type { Account, Category } from "../lib/types";


const OCCUPATIONS = ["Student", "Software / IT", "Business owner", "Doctor / Healthcare", "Teacher / Educator", "Engineer", "Finance / Banking",
  "Government employee", "Homemaker", "Retired", "Freelancer", "Sales / Marketing", "Artist / Creative", "Farmer", "Other"];
type Prof = { display_name: string; age: string; location: string; occupation: string };

export default function Settings({ onBack, onMetrics }: { onBack: () => void; onMetrics: () => void }) {
  const L = useLedger();
  const { busy, error, run } = useAction();
  const [admin, setAdmin] = useState(false);
  const [newAcc, setNewAcc] = useState(""); const [newCur, setNewCur] = useState(DEFAULT_CURRENCY); const [newBal, setNewBal] = useState(""); const [newOwe, setNewOwe] = useState(false); const [newCat, setNewCat] = useState("");
  const today = useToday(); const bd = useBalanceDate(today);
  const [del, setDel] = useState(false); const [typed, setTyped] = useState("");

  const [prof, setProf] = useState<Prof>({ display_name: "", age: "", location: "", occupation: "" });
  const [profErr, setProfErr] = useState<string | null>(null);
  useEffect(() => {
    if (!L.s.userId) return;
    supabase.from("profiles").select("display_name, age, location, occupation").eq("user_id", L.s.userId).maybeSingle().then((r) => {
      if (r.data) setProf({ display_name: r.data.display_name ?? "", age: r.data.age?.toString() ?? "", location: r.data.location ?? "", occupation: r.data.occupation ?? "" });
    }, () => undefined);
  }, [L.s.userId]);
  // Saves one field when it is left. Empty clears it; age must be 13 to 120 (the database checks the same).
  async function saveProf(patch: Partial<Prof>) {
    const next = { ...prof, ...patch }; setProf(next); setProfErr(null);
    const age = next.age.trim() === "" ? null : Number(next.age);
    if (age !== null && !(Number.isInteger(age) && age >= 13 && age <= 120)) return setProfErr("Age must be between 13 and 120");
    const r = await supabase.from("profiles").update({
      display_name: next.display_name.trim() || null, age, location: next.location.trim() || null, occupation: next.occupation || null,
    }).eq("user_id", L.s.userId!);
    if (r.error) setProfErr("Couldn't save. Try again."); else toast("Saved");
  }

  // The metrics page only shows for the owner: the database says no to everyone else.
  useEffect(() => { supabase.rpc("admin_metrics").then((r) => setAdmin(!r.error), () => undefined); }, []);

  const hasEntries = (a: Account) => L.entries.some((e) => e.account_id === a.id);
  const rename = (kind: "a" | "c", x: Account | Category, name: string) => {
    const v = name.trim();
    if (!v || v === x.name) return;
    run(() => (kind === "a" ? updateAccount(x.id, { name: v }) : updateCategory(x.id, { name: v })).then(() => toast("Renamed")));
  };
  const archive = (kind: "a" | "c", x: Account | Category) => run(() => {
    const archived_at = x.archived_at ? null : new Date().toISOString();
    return kind === "a" ? updateAccount(x.id, { archived_at }) : updateCategory(x.id, { archived_at });
  });

  return (
    <main className="screen stack" style={{ gap: "var(--sp-4)" }}>
      <div className="row"><button className="iconbtn" aria-label="Back" onClick={onBack}><Icon name="back" /></button><h1>Settings</h1></div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card stack" aria-label="Profile">
        <b>About you</b>
        <label className="stack" style={{ gap: 4 }}><span className="lbl" style={{ margin: 0 }}>Name</span>
          <input className="field" maxLength={80} autoComplete="name" value={prof.display_name} onChange={(e) => setProf({ ...prof, display_name: e.target.value })} onBlur={(e) => saveProf({ display_name: e.target.value })} /></label>
        <div className="row">
          <label className="stack" style={{ gap: 4, width: 96 }}><span className="lbl" style={{ margin: 0 }}>Age</span>
            <input className="field" inputMode="numeric" maxLength={3} value={prof.age} onChange={(e) => setProf({ ...prof, age: e.target.value.replace(/\D/g, "") })} onBlur={(e) => saveProf({ age: e.target.value })} /></label>
          <label className="stack grow" style={{ gap: 4 }}><span className="lbl" style={{ margin: 0 }}>City</span>
            <input className="field" maxLength={80} autoComplete="address-level2" value={prof.location} onChange={(e) => setProf({ ...prof, location: e.target.value })} onBlur={(e) => saveProf({ location: e.target.value })} /></label>
        </div>
        <label className="stack" style={{ gap: 4 }}><span className="lbl" style={{ margin: 0 }}>What you do</span>
          <select className="field" value={prof.occupation} onChange={(e) => saveProf({ occupation: e.target.value })}>
            <option value="">Not set</option>{OCCUPATIONS.map((o) => <option key={o}>{o}</option>)}
          </select></label>
        {profErr && <p className="error" role="alert">{profErr}</p>}
        <p className="muted small" style={{ margin: 0 }}>Optional. Only you see this. It helps us make the app fit people like you.</p>
      </section>

      <section className="card stack" aria-label="Accounts">
        <b>Accounts</b>
        {L.accounts.map((a) => (
          <div key={a.id} className="row">
            <label className="namefield grow" style={{ opacity: a.archived_at ? .55 : 1 }}>
              <input className="bare" aria-label="Account name" maxLength={40} defaultValue={a.name} key={a.name} onBlur={(e) => rename("a", a, e.target.value)} /><Icon name="edit" size={16} />
            </label>
            <select className="field" style={{ width: 88 }} aria-label={`${a.name} currency`} value={a.currency} disabled={hasEntries(a) || busy}
              title={hasEntries(a) ? "Has entries, so the currency is locked" : undefined} onChange={(e) => run(() => updateAccount(a.id, { currency: e.target.value }))}>
              {currencyList(a.currency).map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="btn" style={{ height: "var(--h-md)" }} disabled={busy} onClick={() => archive("a", a)}>{a.archived_at ? "Restore" : "Hide"}</button>
          </div>
        ))}
        <form className="stack" style={{ gap: "var(--sp-2)", paddingTop: "var(--sp-2)", borderTop: "1px solid var(--line)" }}
          onSubmit={(e) => { e.preventDefault(); if (newAcc.trim() && !(newBal.trim() && bd.needsConfirm)) run(async () => { await addAccount(newAcc, newCur, newBal, newOwe, bd.value); setNewAcc(""); setNewBal(""); setNewOwe(false); bd.setValue(today); toast("Account added"); }); }}>
          <span className="caps">New account</span>
          <input className="field" placeholder="Name, like Savings or Wallet" aria-label="New account name" maxLength={40} value={newAcc} onChange={(e) => setNewAcc(e.target.value)} />
          <div className="row">
            <select className="field" style={{ width: 88 }} aria-label="New account currency" value={newCur} onChange={(e) => setNewCur(e.target.value)}>{currencyList().map((c) => <option key={c}>{c}</option>)}</select>
            <input className="field grow" inputMode="decimal" placeholder={newOwe ? "Amount owed today (optional)" : "Balance today (optional)"} aria-label="New account balance today" value={newBal} onChange={(e) => setNewBal(e.target.value)} />
          </div>
          {newBal.trim() && <BalanceDate today={today} bd={bd} />}
          <label className="toggle"><input type="checkbox" checked={newOwe} onChange={(e) => setNewOwe(e.target.checked)} />I owe this amount (like a credit card bill)</label>
          <button className="btn" disabled={busy || !newAcc.trim() || (!!newBal.trim() && bd.needsConfirm)}>Add account</button>
        </form>
        <p className="muted small" style={{ margin: 0 }}>Hidden accounts keep their history. A balance counts from the date you give it.</p>
      </section>

      <section className="card stack" aria-label="Categories">
        <b>Categories</b>
        {L.categories.map((c) => (
          <div key={c.id} className="row">
            <label className="namefield grow" style={{ opacity: c.archived_at ? .55 : 1 }}>
              <input className="bare" aria-label="Category name" maxLength={40} defaultValue={c.name} key={c.name} onBlur={(e) => rename("c", c, e.target.value)} /><Icon name="edit" size={16} />
            </label>
            <button className="btn" style={{ height: "var(--h-md)" }} disabled={busy} onClick={() => archive("c", c)}>{c.archived_at ? "Restore" : "Hide"}</button>
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (newCat.trim()) run(async () => { await addCategory(newCat); setNewCat(""); }); }}>
          <input className="field grow" placeholder="New category" aria-label="New category name" maxLength={40} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button className="btn" style={{ height: "var(--h-md)" }} disabled={busy}>Add</button>
        </form>
      </section>

      <section className="card stack" aria-label="Your data">
        <b>Your data</b>
        <p className="muted small" style={{ margin: 0 }}>To check and improve quick log, the text of what you said or typed (never the audio) is kept next to what you saved. It's deleted with your account.</p>
        <button className="btn" disabled={busy} onClick={() => run(exportCsv)}>Export everything as CSV</button>
        <a className="btn" style={{ color: "inherit", textDecoration: "none" }} href="/privacy.html" target="_blank" rel="noopener">Privacy policy and terms</a>
        {admin && <button className="btn" onClick={onMetrics}>Usage metrics</button>}
      </section>

      <section className="card stack" aria-label="Account">
        <b>Account</b>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        {!del ? <button className="btn" style={{ color: "var(--red)" }} onClick={() => setDel(true)}>Delete my account</button> : (
          <div className="stack">
            <p style={{ margin: 0 }}>This permanently deletes your account and every entry, account, category and budget. It can't be undone. Export first if you want a copy.</p>
            <input className="field" aria-label="Type DELETE to confirm" placeholder="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <div className="row">
              <button className="btn grow" onClick={() => { setDel(false); setTyped(""); }}>Cancel</button>
              <button className="btn dark grow" style={{ height: "var(--h-md)" }} disabled={typed !== "DELETE" || busy} onClick={() => run(deleteMyAccount)}>Delete everything</button>
            </div>
          </div>
        )}
      </section>
      <p className="muted small" style={{ textAlign: "center" }}>{APP_NAME}</p>
    </main>
  );
}
