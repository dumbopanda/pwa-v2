import { useState } from "react";
import { addAccount, addCategory, deleteMyAccount, exportCsv, updateAccount, updateCategory } from "../lib/actions";
import { BalanceDate, Group, Page, Row, toast, useAction, useBalanceDate } from "../components";
import { DEFAULT_CURRENCY, currencyList } from "../config";
import { useLedger, useToday } from "../lib/hooks";

// The sub-screens of Profile: accounts, categories, data and privacy, delete account.

const Err = ({ msg }: { msg: string | null }) => (msg ? <p className="error" role="alert">{msg}</p> : null);
const hint = (t: string) => <p className="muted small" style={{ margin: 0 }}>{t}</p>;

export function AccountsPage({ onOpen, onAdd, onBack }: { onOpen: (id: string) => void; onAdd: () => void; onBack: () => void }) {
  const L = useLedger();
  return (
    <Page title="Accounts" onBack={onBack}>
      <Group>
        {L.accounts.map((a, i) => (
          <Row key={a.id} lead={<span className={`ttile acc${i % 4}`} aria-hidden="true">{a.name.charAt(0).toUpperCase()}</span>}
            label={a.name} value={a.archived_at ? `${a.currency} · Hidden` : a.currency} dim={!!a.archived_at} onClick={() => onOpen(a.id)} />
        ))}
      </Group>
      <button className="btn" onClick={onAdd}>Add account</button>
      {hint("Hidden accounts keep their history.")}
    </Page>
  );
}

export function AccountPage({ id, onBack }: { id: string; onBack: () => void }) {
  const L = useLedger();
  const a = L.accounts.find((x) => x.id === id);
  const { busy, error, run } = useAction();
  const [name, setName] = useState(a?.name ?? "");
  if (!a) return <Page title="Account" onBack={onBack}>{hint("This account is gone.")}</Page>;
  const locked = L.entries.some((e) => e.account_id === a.id);
  const v = name.trim();
  return (
    <Page title={a.name} onBack={onBack}>
      <section className="card stack">
        <label className="stack" style={{ gap: 4 }}><span className="lbl" style={{ margin: 0 }}>Name</span>
          <input className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn primary" disabled={busy || !v || v === a.name} onClick={() => run(() => updateAccount(a.id, { name: v }).then(() => toast("Renamed")))}>Save name</button>
        <label className="stack" style={{ gap: 4 }}><span className="lbl" style={{ margin: 0 }}>Currency</span>
          <select className="field" value={a.currency} disabled={locked || busy} onChange={(e) => run(() => updateAccount(a.id, { currency: e.target.value }))}>
            {currencyList(a.currency).map((c) => <option key={c}>{c}</option>)}
          </select></label>
        {locked && hint("This account has entries, so the currency is locked.")}
      </section>
      <button className="btn" disabled={busy} onClick={() => run(() => updateAccount(a.id, { archived_at: a.archived_at ? null : new Date().toISOString() }).then(onBack))}>{a.archived_at ? "Restore account" : "Hide account"}</button>
      {hint("Hidden accounts keep their history.")}
      <Err msg={error} />
    </Page>
  );
}

export function AddAccountPage({ onBack }: { onBack: () => void }) {
  const { busy, error, run } = useAction();
  const today = useToday(); const bd = useBalanceDate(today);
  const [name, setName] = useState(""); const [cur, setCur] = useState(DEFAULT_CURRENCY); const [bal, setBal] = useState(""); const [owe, setOwe] = useState(false);
  const blocked = !name.trim() || (!!bal.trim() && bd.needsConfirm);
  return (
    <Page title="New account" onBack={onBack}>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (!blocked) run(async () => { await addAccount(name, cur, bal, owe, bd.value); toast("Account added"); onBack(); }); }}>
        <input className="field" placeholder="Name, like Savings or Wallet" aria-label="Account name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <select className="field" style={{ width: 88 }} aria-label="Currency" value={cur} onChange={(e) => setCur(e.target.value)}>{currencyList().map((c) => <option key={c}>{c}</option>)}</select>
          <input className="field grow" inputMode="decimal" placeholder={owe ? "Amount owed today (optional)" : "Balance today (optional)"} aria-label="Balance today" value={bal} onChange={(e) => setBal(e.target.value)} />
        </div>
        {bal.trim() && <BalanceDate today={today} bd={bd} />}
        <label className="toggle"><input type="checkbox" checked={owe} onChange={(e) => setOwe(e.target.checked)} />I owe this amount (like a credit card bill)</label>
        <button className="btn primary" disabled={busy || blocked}>Add account</button>
        {hint("A balance counts from the date you give it.")}
      </form>
      <Err msg={error} />
    </Page>
  );
}

export function CategoriesPage({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const L = useLedger();
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  return (
    <Page title="Categories" onBack={onBack}>
      <Group>
        {L.categories.map((c) => <Row key={c.id} label={c.name} value={c.archived_at ? "Hidden" : undefined} dim={!!c.archived_at} onClick={() => onOpen(c.id)} />)}
      </Group>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(async () => { await addCategory(name); setName(""); }); }}>
        <input className="field grow" placeholder="New category" aria-label="New category name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={busy || !name.trim()}>Add</button>
      </form>
      <Err msg={error} />
    </Page>
  );
}

export function CategoryPage({ id, onBack }: { id: string; onBack: () => void }) {
  const L = useLedger();
  const c = L.categories.find((x) => x.id === id);
  const { busy, error, run } = useAction();
  const [name, setName] = useState(c?.name ?? "");
  if (!c) return <Page title="Category" onBack={onBack}>{hint("This category is gone.")}</Page>;
  const v = name.trim();
  return (
    <Page title={c.name} onBack={onBack}>
      <section className="card stack">
        <label className="stack" style={{ gap: 4 }}><span className="lbl" style={{ margin: 0 }}>Name</span>
          <input className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn primary" disabled={busy || !v || v === c.name} onClick={() => run(() => updateCategory(c.id, { name: v }).then(() => toast("Renamed")))}>Save name</button>
      </section>
      <button className="btn" disabled={busy} onClick={() => run(() => updateCategory(c.id, { archived_at: c.archived_at ? null : new Date().toISOString() }).then(onBack))}>{c.archived_at ? "Restore category" : "Hide category"}</button>
      {hint("Hidden categories keep their history.")}
      <Err msg={error} />
    </Page>
  );
}

export function DataPage({ onBack }: { onBack: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <Page title="Data & privacy" onBack={onBack}>
      <Group>
        <Row icon="download" label="Export everything as CSV" disabled={busy} onClick={() => run(exportCsv)} />
        <Row icon="note" label="Privacy policy and terms" href="/privacy.html" />
      </Group>
      {hint("To check and improve quick log, the text of what you said or typed (never the audio) is kept next to what you saved. It's deleted with your account.")}
      <Err msg={error} />
    </Page>
  );
}

export function DeletePage({ onBack }: { onBack: () => void }) {
  const { busy, error, run } = useAction();
  const [typed, setTyped] = useState("");
  return (
    <Page title="Delete account" onBack={onBack}>
      <section className="card stack">
        <p style={{ margin: 0 }}>This permanently deletes your account and every entry, account, category and budget. It can't be undone. Export first if you want a copy.</p>
        <input className="field" aria-label="Type DELETE to confirm" placeholder="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn dark" disabled={typed !== "DELETE" || busy} onClick={() => run(deleteMyAccount)}>Delete everything</button>
      </section>
      <Err msg={error} />
    </Page>
  );
}
