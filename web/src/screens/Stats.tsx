import { useState } from "react";
import { MonthNav } from "../components";
import Icon from "../Icon";
import { dayLabel } from "../lib/format";
import { useLedger, useToday } from "../lib/hooks";
import { addMonths, balances, daysInMonth, isSpend, loggedDatesOf, monthOf, monthTotals, spendBy, spendByDay, toneOf } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { monthLabel } from "../lib/reviewFacts";

type View = "category" | "account" | "name";
const VIEWS: [View, string][] = [["category", "Category"], ["account", "Account"], ["name", "Name"]];
const TOP = 5;

/** Stats, as in the old app: what you have, the month's two flows, where it went, when it went, a few facts. */
export default function Stats() {
  const L = useLedger(); const today = useToday();
  const [ym, setYm] = useState(monthOf(today));
  const [pick, setPick] = useState<string | null>(null);
  const [view, setView] = useState<View>("category");
  const [more, setMore] = useState(false);
  const [day, setDay] = useState<number | null>(null);

  const isNow = ym === monthOf(today);
  const end = isNow ? today : `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
  const currencies = [...new Set(L.accounts.map((a) => a.currency))].sort((a, b) => (a === L.s.currency ? -1 : b === L.s.currency ? 1 : a.localeCompare(b)));
  const currency = pick && currencies.includes(pick) ? pick : currencies[0] ?? L.s.currency;
  const m = (n: number) => formatMoney(n, currency);
  const signed = (n: number) => (n < 0 ? "−" : "") + m(Math.abs(n));

  // What you have, at the end of the month you're looking at.
  const bal = balances(L.entries, end);
  const accts = L.accounts.filter((a) => a.currency === currency && (!a.archived_at || (bal.get(a.id) ?? 0) !== 0));
  const have = accts.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);

  const t = monthTotals(L.entries, L.accounts, ym).get(currency) ?? { spent: 0, income: 0, net: 0 };
  const cur = new Map(L.accounts.map((a) => [a.id, a.currency]));
  const spends = L.entries.filter((e) => isSpend(e) && monthOf(e.entry_date) === ym && cur.get(e.account_id) === currency);

  const keyOf = (e: (typeof spends)[number]) => view === "category" ? e.category_id ?? "" : view === "account" ? e.account_id : e.expense_name.trim().toLowerCase();
  const rows = spendBy(L.entries, L.accounts, ym, currency, keyOf);
  const counts = new Map<string, number>(); for (const e of spends) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
  const label = (k: string) => view === "category" ? (k ? L.categoryById.get(k)?.name ?? "Other" : "No category") : view === "account" ? L.accountById.get(k)?.name ?? "?" : k;
  const pct = (v: number) => (t.spent ? Math.round((v * 100) / t.spent) : 0);          // display only, never stored
  // An "Others" row only when it would hold two or more.
  const cut = rows.length <= TOP + 1 ? rows.length : TOP;
  const shown = rows.slice(0, cut), rest = rows.slice(cut);
  const restSum = rest.reduce((s, r) => s + r.spent, 0);

  const perDay = spendByDay(L.entries, L.accounts, ym, currency);
  const peak = Math.max(...perDay, 0);
  const lastDay = isNow ? Number(today.slice(8)) : perDay.length;
  const logged = [...loggedDatesOf(L.entries)].filter((d) => monthOf(d) === ym).length;
  const noSpend = [...L.noSpend].filter((d) => monthOf(d) === ym).length;
  const peakDay = peak > 0 ? perDay.indexOf(peak) + 1 : null;
  const ax = [1, 8, 15, 22, perDay.length];
  // Drag across the chart to read any day (the old app's gesture): the whole strip is the target, not 9px bars.
  function pickDay(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect(), pad = 16;
    const i = Math.floor(((e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad)) * perDay.length);
    setDay(Math.min(lastDay - 1, Math.max(0, i)));          // no reading days that haven't happened yet
  }

  const Row = ({ rank, name, value, meta, first, onClick }: { rank: number | string; name: React.ReactNode; value: number; meta: string; first?: boolean; onClick?: () => void }) => {
    const body = (
      <>
        <span className="brank">{rank}</span>
        <span className="btop"><span className="bname">{name}</span><span className="bval">{m(value)}</span></span>
        <span className="bmeta">{meta}</span>
        <span className="bbar"><span className={first ? "strong" : ""} style={{ width: `${Math.max(2, rows[0] ? (value * 100) / rows[0].spent : 0)}%` }} /></span>
      </>
    );
    return onClick ? <button type="button" className="brow others" onClick={onClick} aria-expanded={more}>{body}</button> : <div className="brow">{body}</div>;
  };

  return (
    <main className="screen stack" style={{ gap: "var(--sp-3)" }}>
      <MonthNav ym={ym} label={monthLabel(ym)} max={monthOf(today)} onChange={(d) => { setYm(addMonths(ym, d)); setDay(null); setMore(false); }} />
      {currencies.length > 1 && <div className="fchips">{currencies.map((c) => <button key={c} className="fchip" aria-pressed={c === currency} onClick={() => setPick(c)}>{c}</button>)}</div>}

      <section className="hero have" aria-label="What you have">
        <div className="hkey"><span>What you have</span><span className="hchip">{isNow ? "today" : `on ${dayLabel(end)}`}</span></div>
        <div className={`hval${have < 0 ? " neg" : ""}`}>{signed(have)}</div>
        {accts.length > 0 && (
          <div className="haccts">
            {accts.map((a) => (
              <div key={a.id} className="hacct">
                <span className="k"><i className={`dot acc${toneOf(L.accounts, a.id)}`} aria-hidden="true" />{a.name}</span>
                <span className={`v${(bal.get(a.id) ?? 0) < 0 ? " neg" : ""}`}>{signed(bal.get(a.id) ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card duo" aria-label="Money out and in">
        <div><span className="k"><i className="o" aria-hidden="true"><Icon name="out" size={12} /></i>Money out</span><b>{m(t.spent)}</b><span className="s">{spends.length} {spends.length === 1 ? "entry" : "entries"}</span></div>
        <div><span className="k"><i className="n" aria-hidden="true"><Icon name="in" size={12} /></i>Money in</span><b>{m(t.income)}</b><span className="s">Net {t.net > 0 ? "+" : ""}{signed(t.net)}</span></div>
      </section>

      {t.spent === 0 ? (
        <div className="emptystate"><h2>No spending in {monthLabel(ym)}</h2><p>Log an entry and this fills in: where it went, and when.</p></div>
      ) : (
        <>
          <section className="card panel" aria-label="Where it went">
            <div className="phead"><span className="ptitle">Where it went</span><span className="pnote">{m(t.spent)}</span></div>
            <div className="slideseg" role="group" aria-label="Group by" style={{ ["--i" as string]: VIEWS.findIndex(([v]) => v === view), ["--n" as string]: VIEWS.length }}>
              <span className="thumb" aria-hidden="true" />
              {VIEWS.map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); setMore(false); }}>{l}</button>)}
            </div>
            <div className="brk">
              {shown.map((r, i) => <Row key={r.key} rank={i + 1} first={i === 0} name={<span style={{ textTransform: view === "name" ? "capitalize" : undefined }}>{label(r.key)}</span>} value={r.spent} meta={`${pct(r.spent)}% · ${counts.get(r.key) ?? 0} ${counts.get(r.key) === 1 ? "entry" : "entries"}`} />)}
              {rest.length > 0 && <Row rank="…" name={<>Others <small>{rest.length}</small> <span className={`chev${more ? " up" : ""}`}><Icon name="down" size={14} /></span></>} value={restSum} meta={`${pct(restSum)}%`} onClick={() => setMore(!more)} />}
              {more && rest.map((r, i) => <Row key={r.key} rank={cut + i + 1} name={<span style={{ textTransform: view === "name" ? "capitalize" : undefined }}>{label(r.key)}</span>} value={r.spent} meta={`${pct(r.spent)}% · ${counts.get(r.key) ?? 0} entries`} />)}
            </div>
          </section>

          <section className="card panel" aria-label="When it went">
            <div className="phead"><span className="ptitle">When it went</span><span className="pnote">Drag to read a day</span></div>
            <div className="dbars" role="slider" tabIndex={0} aria-label="Spending by day. Drag across, or use the arrow keys."
              aria-valuemin={1} aria-valuemax={lastDay} aria-valuenow={(day ?? (peakDay ? peakDay - 1 : 0)) + 1}
              aria-valuetext={`${(day ?? (peakDay ? peakDay - 1 : 0)) + 1} ${monthLabel(ym)}: ${m(perDay[day ?? (peakDay ? peakDay - 1 : 0)] ?? 0)}`}
              onPointerDown={(e) => pickDay(e)} onPointerMove={(e) => e.buttons && pickDay(e)}
              onKeyDown={(e) => {
                const cur = day ?? (peakDay ? peakDay - 1 : 0);
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setDay(Math.min(lastDay - 1, Math.max(0, cur + (e.key === "ArrowRight" ? 1 : -1)))); }
              }}>
              {perDay.map((v, i) => (
                <span key={i} className={`dcol${i + 1 > lastDay ? " future" : v === 0 ? " zero" : v === peak ? " peak" : ""}${day === i ? " sel" : ""}`}>
                  <i style={{ height: peak ? `${Math.max(2, (v / peak) * 100)}%` : "2px" }} />
                </span>
              ))}
            </div>
            <div className="dax" aria-hidden="true">{ax.map((d) => <span key={d} style={{ left: `${((d - 0.5) / perDay.length) * 100}%` }}>{d}</span>)}</div>
            <p className="dread" aria-live="polite">{day !== null ? <><b>{m(perDay[day])}</b> on {dayLabel(`${ym}-${String(day + 1).padStart(2, "0")}`)}</> : peakDay ? <>Biggest day: <b>{m(peak)}</b> on {dayLabel(`${ym}-${String(peakDay).padStart(2, "0")}`)}</> : null}</p>
          </section>
        </>
      )}

      <section className="card panel facts" aria-label="Facts">
        <div className="phead"><span className="ptitle">This month</span></div>
        <div className="fact"><span className="k">Days logged</span><span className="v">{logged} of {lastDay}</span></div>
        <div className="fact"><span className="k">No-spend days</span><span className="v">{noSpend}</span></div>
        <div className="fact"><span className="k">Average a day</span><span className="v">{m(lastDay ? Math.floor(t.spent / lastDay) : 0)}</span></div>
      </section>
      <p className="muted small" style={{ margin: 0, textAlign: "center" }}>Transfers between your accounts and opening balances aren't spending or income.</p>
    </main>
  );
}
