import { useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import { reopenDay } from "../lib/actions";
import { toast, useAction } from "../components";
import { amountText, draftFromEntry } from "../lib/entryRows";
import { useLedger, useToday } from "../lib/hooks";
import { addDays, daysInMonth, isLate, isLogged, monthOf, openPastDays } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { monthLabel } from "../lib/reviewFacts";
import type { Entry } from "../lib/types";
import CloseDay from "./CloseDay";
import Detail from "./Detail";
import EntrySheet from "./EntrySheet";
import { buildLines, Lines } from "./EntryRow";

type Kind = "all" | "out" | "in" | "move";
const KINDS: [Kind, string][] = [["all", "All"], ["out", "Money out"], ["in", "Money in"], ["move", "Transfers"]];
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const wdFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" });
const closedFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** History, as in the old app: month line, one bar of filters, then each day as its own card. */
export default function History({ ym, openOnly, onOpenOnly }: { ym: string; openOnly: boolean; onOpenOnly: (v: boolean) => void }) {
  const L = useLedger(); const today = useToday();
  const [kind, setKind] = useState<Kind>("all");
  const [account, setAccount] = useState(""); const [category, setCategory] = useState("");
  const [q, setQ] = useState(""); const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<Entry | null>(null); const [edit, setEdit] = useState<Entry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([today]));
  const [closing, setClosing] = useState<string | null>(null);
  const { busy, run } = useAction();
  const needle = q.trim().toLowerCase();

  const filtered = kind !== "all" || !!account || !!category;
  const cross = !!needle || openOnly;                                          // a search or "Open days" covers every month
  const openSet = useMemo(() => new Set(openPastDays(today, L.closed, L.start)), [today, L.closed, L.start]);

  const byDay = useMemo(() => {
    // A transfer belongs to both accounts it touches.
    const touched = new Set(L.entries.filter((e) => e.transfer_group && e.account_id === account).map((e) => e.transfer_group));
    const rows = L.entries.filter((e) => isLogged(e)
      && (cross ? true : monthOf(e.entry_date) === ym)
      && (!account || e.account_id === account || (e.transfer_group !== null && touched.has(e.transfer_group)))
      && (!category || e.category_id === category)
      && (kind === "all" || (kind === "move" ? !!e.transfer_group : !e.transfer_group && (kind === "out") === (e.direction === "debit")))
      && (!needle || e.expense_name.toLowerCase().includes(needle) || (e.more_info ?? "").toLowerCase().includes(needle)
        || amountText(e.amount_minor, L.accountById.get(e.account_id)?.currency ?? "INR").includes(needle.replace(/,/g, ""))))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const by = new Map<string, Entry[]>();
    for (const e of rows) by.set(e.entry_date, [...(by.get(e.entry_date) ?? []), e]);
    return by;
  }, [L.entries, L.accountById, ym, kind, account, category, needle, cross]);

  // Every day of the month shows, even an empty one, so it can be closed. Filters and search show only days with matches.
  const dates = useMemo(() => {
    let ds: string[];
    if (needle || filtered) ds = [...byDay.keys()];
    else if (openOnly) ds = [...openSet];
    else {
      const last = `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
      const to = last < today ? last : today;
      const from = L.start && L.start > `${ym}-01` ? L.start : `${ym}-01`;
      const set = new Set(byDay.keys());
      if (L.start) for (let d = to; d >= from; d = addDays(d, -1)) set.add(d);
      ds = [...set];
    }
    if (openOnly) ds = ds.filter((d) => openSet.has(d));
    return ds.sort((a, b) => b.localeCompare(a));
  }, [byDay, needle, filtered, openOnly, openSet, ym, today, L.start]);
  const days = dates.map((d) => [d, byDay.get(d) ?? []] as [string, Entry[]]);

  const count = days.reduce((n, [, es]) => n + buildLines(es, L.accountById, L.categoryById).length, 0);
  const dayName = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : wdFmt.format(new Date(`${d}T00:00:00Z`)));

  return (
    <main className="screen stack" style={{ gap: "var(--sp-3)" }}>
      <div className="histbar">
        <div className="fchips" role="toolbar" aria-label="Filters">
          <div className={`fsearch${searching || q ? " open" : ""}`}>
            <button type="button" className="fs-btn" aria-label="Search" onClick={() => { setSearching(true); setTimeout(() => searchRef.current?.focus(), 0); }}><Icon name="search" size={16} /></button>
            <input ref={searchRef} type="search" tabIndex={searching || q ? 0 : -1} placeholder="Name, note or amount" aria-label="Search all months" value={q}
              onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearching(false)} />
            {(searching || q) && <button type="button" className="fs-clear" aria-label="Clear search" onClick={() => { setQ(""); setSearching(false); }}><Icon name="close" size={14} /></button>}
          </div>
          <span className="fs-div" aria-hidden="true" />
          <button type="button" className="fchip" aria-pressed={kind === "all" && !openOnly} onClick={() => { setKind("all"); onOpenOnly(false); }}>All</button>
          <button type="button" className="fchip" aria-pressed={openOnly} onClick={() => onOpenOnly(!openOnly)}>Open days</button>
          {KINDS.filter(([k]) => k !== "all").map(([k, label]) => <button key={k} type="button" className="fchip" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}
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

      {openOnly && !needle && <p className="searchsum">Past days you haven't closed yet, all months</p>}

      {days.length === 0 ? (
        <div className="emptystate">
          <h2>{openOnly ? "No open days" : needle || filtered ? "Nothing matches" : L.entries.some(isLogged) ? `Nothing in ${monthLabel(ym)}` : "Nothing here yet"}</h2>
          <p>{openOnly ? "Every past day is closed." : needle || filtered ? "Try another word, or clear the filters." : "Entries you log show up here, one card per day."}</p>
          {(needle || filtered || openOnly) && <button className="showmore" onClick={() => { setQ(""); setSearching(false); setKind("all"); setAccount(""); setCategory(""); onOpenOnly(false); }}>Clear filters</button>}
        </div>
      ) : (
        <div className="daylist">
          {days.map(([date, es]) => {
            const lines = buildLines(es, L.accountById, L.categoryById, L.accounts);
            const net = new Map<string, number>();
            for (const l of lines) if (l.kind !== "move") { const c = L.accountById.get(l.entry.account_id)?.currency ?? "INR"; net.set(c, (net.get(c) ?? 0) + (l.kind === "in" ? l.entry.amount_minor : -l.entry.amount_minor)); }
            const out = [...net].filter(([, m]) => m !== 0).map(([c, m]) => (m < 0 ? "−" : "+") + formatMoney(Math.abs(m), c)).join(" · ");
            const closedAt = L.closed[date];
            const isToday = date === today;
            const lateN = es.filter((e) => isLate(e, L.closed) && (!e.transfer_group || e.direction === "debit")).length;
            const shown = expanded.has(date) || !!needle || filtered;
            const sub = lines.length === 0 ? (closedAt ? "No spend" : "No entries")
              : [`${lines.length} ${lines.length === 1 ? "entry" : "entries"}`, out, lateN ? `${lateN} added later` : ""].filter(Boolean).join(" · ");
            const toggle = () => setExpanded((x) => { const n = new Set(x); if (n.has(date)) n.delete(date); else n.add(date); return n; });
            return (
              <section key={date} className={`daycard${shown ? "" : " collapsed"}`} aria-label={`${dayName(date)}, ${dayFmt.format(new Date(`${date}T00:00:00Z`))}`}>
                <button type="button" className={`dayhead2${isToday ? " today" : ""}`} aria-expanded={shown} onClick={toggle}>
                  <span className="dname2"><b>{dayFmt.format(new Date(`${date}T00:00:00Z`))}<small>{dayName(date)}</small></b><span className="dsub">{sub}</span></span>
                  <span className="right">
                    {closedAt
                      ? <span className="status closed"><Icon name="lock" size={14} />Closed</span>
                      : <span className={`status ${isToday ? "open" : "past"}`}>Open</span>}
                    <span className="chev"><Icon name="down" size={16} /></span>
                  </span>
                </button>
                {shown && (
                  <>
                    {lines.length ? <Lines lines={lines} onOpen={setDetail} late={(e) => isLate(e, L.closed)} /> : <p className="noentry">No entries on this day.</p>}
                    <div className="dayfoot">
                      {!closedAt && <>
                        <span className="grow muted small">{lines.length ? (isToday ? "All of today's payments in?" : "All of this day's payments in?") : "Nothing recorded for this day."}</span>
                        <button className="btn primary" onClick={() => setClosing(date)}><Icon name="check" size={16} />Close day</button>
                      </>}
                      {closedAt && (
                        <>
                          <span className="lockline"><Icon name="lock" size={16} />{isToday ? `Closed ${closedFmt.format(new Date(closedAt))}.` : `Closed ${closedFmt.format(new Date(closedAt))}. You can still add a forgotten payment.`}</span>
                          {isToday && <button className="btn" disabled={busy} onClick={() => run(async () => { await reopenDay(date); toast("Day reopened"); })}>Reopen</button>}
                        </>
                      )}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}

      {closing && <CloseDay date={closing} onClose={() => setClosing(null)} />}
      {detail && <Detail entry={detail} onClose={() => setDetail(null)} onEdit={(e) => { setEdit(e); setDetail(null); }} />}
      {edit && <EntrySheet initial={draftFromEntry(edit, L.accountById.get(edit.account_id)?.currency ?? "INR")} existing={edit} via="manual" onClose={() => setEdit(null)} />}
    </main>
  );
}
