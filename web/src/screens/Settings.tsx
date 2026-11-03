import Icon from "../Icon";
import { useEffect, useState } from "react";
import { addAccount, addCategory, deleteMyAccount, exportCsv, updateAccount, updateCategory } from "../lib/actions";
import { toast, useAction } from "../components";
import { APP_NAME, DEFAULT_CURRENCY } from "../config";
import { useLedger } from "../lib/hooks";
import { supabase } from "../supabase";
import type { Account, Category } from "../lib/types";

const CURRENCIES = [DEFAULT_CURRENCY, ...Intl.supportedValuesOf("currency").filter((c) => c !== DEFAULT_CURRENCY)];

export default function Settings({ onBack, onMetrics }: { onBack: () => void; onMetrics: () => void }) {
  const L = useLedger();
  const { busy, error, run } = useAction();
  const [admin, setAdmin] = useState(false);
  const [newAcc, setNewAcc] = useState(""); const [newCur, setNewCur] = useState(DEFAULT_CURRENCY); const [newCat, setNewCat] = useState("");
  const [del, setDel] = useState(false); const [typed, setTyped] = useState("");

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

      <section className="card stack" aria-label="Accounts">
        <b>Accounts</b>
        {L.accounts.map((a) => (
          <div key={a.id} className="row">
            <input className="field grow" aria-label="Account name" maxLength={40} defaultValue={a.name} key={a.name} onBlur={(e) => rename("a", a, e.target.value)} style={{ opacity: a.archived_at ? .55 : 1 }} />
            <select className="field" style={{ width: 88 }} aria-label={`${a.name} currency`} value={a.currency} disabled={hasEntries(a) || busy}
              title={hasEntries(a) ? "Has entries, so the currency is locked" : undefined} onChange={(e) => run(() => updateAccount(a.id, { currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="btn" style={{ height: "var(--h-md)" }} disabled={busy} onClick={() => archive("a", a)}>{a.archived_at ? "Restore" : "Hide"}</button>
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (newAcc.trim()) run(async () => { await addAccount(newAcc, newCur); setNewAcc(""); }); }}>
          <input className="field grow" placeholder="New account" aria-label="New account name" maxLength={40} value={newAcc} onChange={(e) => setNewAcc(e.target.value)} />
          <select className="field" style={{ width: 88 }} aria-label="New account currency" value={newCur} onChange={(e) => setNewCur(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn" style={{ height: "var(--h-md)" }} disabled={busy}>Add</button>
        </form>
        <p className="muted small" style={{ margin: 0 }}>Hidden accounts keep their history. Balances are set when you add the account.</p>
      </section>

      <section className="card stack" aria-label="Categories">
        <b>Categories</b>
        {L.categories.map((c) => (
          <div key={c.id} className="row">
            <input className="field grow" aria-label="Category name" maxLength={40} defaultValue={c.name} key={c.name} onBlur={(e) => rename("c", c, e.target.value)} style={{ opacity: c.archived_at ? .55 : 1 }} />
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
        <button className="btn" disabled={busy} onClick={() => run(exportCsv)}>Export everything as CSV</button>
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
