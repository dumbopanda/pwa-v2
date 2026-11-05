import { useMemo, useRef, useState } from "react";
import { MonthNav } from "../components";
import Icon from "../Icon";
import { amountText, draftFromEntry } from "../lib/entryRows";
import { useLedger, useToday } from "../lib/hooks";
import { addDays, addMonths, isLogged, monthOf } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { monthLabel } from "../lib/reviewFacts";
import type { Entry } from "../lib/types";
import Detail from "./Detail";
import EntrySheet from "./EntrySheet";
import { buildLines, Lines } from "./EntryRow";

type Kind = "all" | "out" | "in" | "move";
const KINDS: [Kind, string][] = [["all", "All"], ["out", "Money out"], ["in", "Money in"], ["move", "Transfers"]];
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const wdFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" });

/** History, as in the old app: month line, one bar of filters, then each day as its own card. */
export default function History() {
  const L = useLedger(); const today = useToday();
  const [ym, setYm] = useState(monthOf(today));
  const [kind, setKind] = useState<Kind>("all");
  const [account, setAccount] = useState(""); const [category, setCategory] = useState("");
  const [q, setQ] = useState(""); const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<Entry | null>(null); const [edit, setEdit] = useState<Entry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const needle = q.trim().toLowerCase();

  const days = useMemo(() => {
    // A transfer belongs to both accounts it touches.
    const touched = new Set(L.entries.filter((e) => e.transfer_group && e.account_id === account).map((e) => e.transfer_group));
    const rows = L.entries.filter((e) => isLogged(e)
      && (needle ? true : monthOf(e.entry_date) === ym)                      // a search covers every month
      && (!account || e.account_id === account || (e.transfer_group !== null && touched.has(e.transfer_group)))
      && (!category || e.category_id === category)
      && (kind === "all" || (kind === "move" ? !!e.transfer_group : !e.transfer_group && (kind === "out") === (e.direction === "debit")))
      && (!needle || e.expense_name.toLowerCase().includes(needle) || (e.more_info ?? "").toLowerCase().includes(needle)
        || amountText(e.amount_minor, L.accountById.get(e.account_id)?.currency ?? "INR").includes(needle.replace(/,/g, ""))))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
    const by = new Map<string, Entry[]>();
    for (const e of rows) by.set(e.entry_date, [...(by.get(e.entry_date) ?? []), e]);
    return [...by];
  }, [L.entries, L.accountById, ym, kind, account, category, needle]);

  const count = days.reduce((n, [, es]) => n + buildLines(es, L.accountById, L.categoryById).length, 0);
  const dayName = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : wdFmt.format(new Date(`${d}T00:00:00Z`)));
  const filtered = kind !== "all" || account || category;

  return (
    <main className="screen stack" style={{ gap: "var(--sp-3)" }}>
      <div className="histbar">
        <div className={needle ? "dim" : ""}><MonthNav ym={ym} label={monthLabel(ym)} max={monthOf(today)} onChange={(d) => setYm(addMonths(ym, d))} /></div>
        <div className="fchips" role="toolbar" aria-label="Filters">
          <div className={`fsearch${searching || q ? " open" : ""}`}>
            <button type="button" className="fs-btn" aria-label="Search" onClick={() => { setSearching(true); setTimeout(() => searchRef.current?.focus(), 0); }}><Icon name="search" size={16} /></button>
            <input ref={searchRef} type="search" tabIndex={searching || q ? 0 : -1} placeholder="Name, note or amount" aria-label="Search all months" value={q}
              onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearching(false)} />
            {(searching || q) && <button type="button" className="fs-clear" aria-label="Clear search" onClick={() => { setQ(""); setSearching(false); }}><Icon name="close" size={14} /></button>}
          </div>
          <span className="fs-div" aria-hidden="true" />
          {KINDS.map(([k, label]) => <button key={k} type="button" className="fchip" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}
          <label className={`fchip select${account ? " on" : ""}`}>
            <span>{account ? L.accountById.get(account)?.name : "Account"}</span><Icon name="down" size={14} />
            <select aria-label="Filter by account" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>{L.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className={`fchip select${category ? " on" : ""}`}>
            <span>{category ? L.categoryById.get(category)?.name : "Category"}</span><Icon name="down" size={14} />
            <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>{L.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {needle && <p className="searchsum" aria-live="polite">{count} {count === 1 ? "entry" : "entries"} matching “{q.trim()}”, all months</p>}

      {days.length === 0 ? (
        <div className="emptystate">
          <h2>{needle || filtered ? "Nothing matches" : L.entries.some(isLogged) ? `Nothing in ${monthLabel(ym)}` : "Nothing here yet"}</h2>
          <p>{needle || filtered ? "Try another word, or clear the filters." : "Entries you log show up here, one card per day."}</p>
          {(needle || filtered) && <button className="showmore" onClick={() => { setQ(""); setSearching(false); setKind("all"); setAccount(""); setCategory(""); }}>Clear filters</button>}
        </div>
      ) : (
        <div className="daylist">
          {days.map(([date, es]) => {
            const lines = buildLines(es, L.accountById, L.categoryById, L.accounts);
            const net = new Map<string, number>();
            for (const l of lines) if (l.kind !== "move") { const c = L.accountById.get(l.entry.account_id)?.currency ?? "INR"; net.set(c, (net.get(c) ?? 0) + (l.kind === "in" ? l.entry.amount_minor : -l.entry.amount_minor)); }
            const sign = [...net.values()].reduce((a, b) => a + b, 0);
            return (
              <section key={date} className="daycard" aria-label={`${dayName(date)}, ${dayFmt.format(new Date(`${date}T00:00:00Z`))}`}>
                <div className={`dayhead2${date === today ? " today" : ""}`}>
                  <span className="dname"><b>{dayName(date)}</b><span>{dayFmt.format(new Date(`${date}T00:00:00Z`))}</span></span>
                  <span className={`dnet ${sign < 0 ? "out" : sign > 0 ? "in" : ""}`}>{[...net].map(([c, m]) => (m < 0 ? "−" : m > 0 ? "+" : "") + formatMoney(Math.abs(m), c)).join(" · ")}</span>
                </div>
                <Lines lines={lines} onOpen={setDetail} />
              </section>
            );
          })}
        </div>
      )}

      {detail && <Detail entry={detail} onClose={() => setDetail(null)} onEdit={(e) => { setEdit(e); setDetail(null); }} />}
      {edit && <EntrySheet initial={draftFromEntry(edit, L.accountById.get(edit.account_id)?.currency ?? "INR")} existing={edit} via="manual" onClose={() => setEdit(null)} />}
    </main>
  );
}
