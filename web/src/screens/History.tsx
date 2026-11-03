import { useMemo, useState } from "react";
import { Empty } from "../components";
import { amountText, draftFromEntry } from "../lib/entryRows";
import { dayLabel } from "../lib/format";
import { useLedger } from "../lib/hooks";
import { isLogged } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import type { Entry } from "../lib/types";
import Detail from "./Detail";
import EntrySheet from "./EntrySheet";
import { buildLines, Lines } from "./EntryRow";

const PAGE = 40; // days shown at a time

export default function History() {
  const L = useLedger();
  const [account, setAccount] = useState(""); const [category, setCategory] = useState(""); const [q, setQ] = useState("");
  const [days, setDays] = useState(PAGE);
  const [detail, setDetail] = useState<Entry | null>(null); const [edit, setEdit] = useState<Entry | null>(null);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // A transfer belongs to both accounts it touches, so filtering by either one keeps it.
    const touched = new Set(L.entries.filter((e) => e.transfer_group && e.account_id === account).map((e) => e.transfer_group));
    const rows = L.entries.filter((e) => isLogged(e) && (!account || e.account_id === account || (e.transfer_group !== null && touched.has(e.transfer_group))) && (!category || e.category_id === category)
      && (!needle || e.expense_name.toLowerCase().includes(needle) || (e.more_info ?? "").toLowerCase().includes(needle) || amountText(e.amount_minor, L.accountById.get(e.account_id)?.currency ?? "INR").includes(needle.replace(/,/g, ""))))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
    const by = new Map<string, Entry[]>();
    for (const e of rows) by.set(e.entry_date, [...(by.get(e.entry_date) ?? []), e]);
    return [...by];
  }, [L.entries, account, category, q]);

  const shown = groups.slice(0, days);
  return (
    <main className="screen stack">
      <h1>History</h1>
      <input className="field" type="search" placeholder="Search name, note or amount" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row">
        <select className="field grow" aria-label="Filter by account" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All accounts</option>{L.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="field grow" aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>{L.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {shown.length === 0 && <Empty>{L.entries.some(isLogged) ? "Nothing matches." : "Nothing here yet."}</Empty>}
      {shown.map(([date, es]) => {
        const lines = buildLines(es, L.accountById, L.categoryById);
        const net = new Map<string, number>();
        for (const l of lines) if (l.kind !== "move") { const c = L.accountById.get(l.entry.account_id)?.currency ?? "INR"; net.set(c, (net.get(c) ?? 0) + (l.kind === "in" ? l.entry.amount_minor : -l.entry.amount_minor)); }
        return (
          <section key={date}>
            <div className="dayhead"><b>{dayLabel(date)}</b><span className="muted small">{[...net].map(([c, m]) => (m < 0 ? "−" : "+") + formatMoney(Math.abs(m), c)).join(" · ")}</span></div>
            <div className="card" style={{ padding: "var(--sp-1) var(--sp-4)" }}><Lines lines={lines} onOpen={setDetail} /></div>
          </section>
        );
      })}
      {groups.length > days && <button className="btn" onClick={() => setDays(days + PAGE)}>Show earlier days</button>}

      {detail && <Detail entry={detail} onClose={() => setDetail(null)} onEdit={(e) => { setEdit(e); setDetail(null); }} />}
      {edit && <EntrySheet initial={draftFromEntry(edit, L.accountById.get(edit.account_id)?.currency ?? "INR")} existing={edit} via="manual" onClose={() => setEdit(null)} />}
    </main>
  );
}
