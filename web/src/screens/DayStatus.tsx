import Icon from "../Icon";
import { useMemo, useState } from "react";
import { setNoSpend } from "../lib/actions";
import { useAction } from "../components";
import { emptyDraft, type Draft } from "../lib/entryRows";
import { dayLabel } from "../lib/format";
import { useLedger, useToday } from "../lib/hooks";
import { addDays, daysInMonth, dayState, isLogged, missedDays, monthOf } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { monthLabel } from "../lib/reviewFacts";
import EntrySheet, { LAST_ACCOUNT } from "./EntrySheet";

/** The month a review should be offered for: the last 3 days of a month, and the first 5 of the next. */
export function reviewMonth(today: string): string | null {
  const ym = monthOf(today), day = Number(today.slice(8));
  if (day >= daysInMonth(ym) - 2) return ym;
  if (day <= 5) return monthOf(addDays(`${ym}-01`, -1));
  return null;
}

/** Top of the dashboard, this month only: the review banner, today's status, and blank days. */
export default function DayStatus({ onReview }: { onReview: (ym: string) => void }) {
  const L = useLedger();
  const today = useToday();
  const [form, setForm] = useState<Draft | null>(null);
  const [showMissed, setShowMissed] = useState(false);
  const { busy, error, run } = useAction();
  const lastAccount = () => { try { return localStorage.getItem(LAST_ACCOUNT); } catch { return null; } };

  const state = (d: string) => dayState(d, L.loggedDates, L.noSpend);
  const first = L.s.firstDay || today;
  const missed = useMemo(() => missedDays(today, state, first, 3), [today, L.loggedDates, L.noSpend, first]);  // eslint-disable-line react-hooks/exhaustive-deps
  const review = reviewMonth(today);
  const stat = state(today);

  // Today's running spend, per currency, never mixed.
  const spent = new Map<string, number>();
  for (const e of L.entries) if (e.entry_date === today && isLogged(e) && e.direction === "debit" && !e.transfer_group && !e.txn_id.startsWith("Y")) {
    const c = L.accountById.get(e.account_id)?.currency ?? "INR"; spent.set(c, (spent.get(c) ?? 0) + e.amount_minor);
  }

  return (
    <>
      {review && L.entries.length > 0 && (
        <button className="card item banner" onClick={() => onReview(review)}>
          <span className="grow"><b>Your {monthLabel(review)} review is ready</b><br /><span className="muted small">See where the money went and plan the next month.</span></span><Icon name="next" />
        </button>
      )}

      <section className="card stack" aria-label="Today's status" style={{ gap: "var(--sp-2)" }}>
       <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className={`pill ${stat === "open" ? "amber" : "green"}`}>{stat === "logged" ? "Logged" : stat === "no_spend" ? "No spend" : "Open"}</span>
          <div className="muted small" style={{ marginTop: "var(--sp-1)" }}>
            {spent.size > 0 ? <><b style={{ color: "var(--text)" }}>{[...spent].map(([c, m]) => formatMoney(m, c)).join(" · ")}</b> spent today</> : stat === "open" ? "Nothing logged today yet" : "Today is done"}
          </div>
        </div>
        {stat !== "logged" && (
          <button className="btn" style={{ height: "var(--h-sm)" }} disabled={busy} onClick={() => run(async () => { await setNoSpend(today, stat !== "no_spend"); })}>
            {stat === "no_spend" ? "Undo no spend" : "I spent nothing"}
          </button>
        )}
       </div>
       {missed.length > 0 && (
        <button className="btn quiet" style={{ height: "auto", padding: 0, justifyContent: "flex-start" }} aria-expanded={showMissed} onClick={() => setShowMissed(!showMissed)}>
          {missed.length === 1 ? "1 day is blank" : `${missed.length} days are blank`} · {showMissed ? "hide" : "fill in"}
        </button>
       )}
       {showMissed && missed.length > 0 && <>
          {missed.map((d) => (
            <div key={d} className="row">
              <span className="grow">{dayLabel(d)}</span>
              <button className="btn" style={{ height: "var(--h-sm)" }} onClick={() => run(async () => { await setNoSpend(d, true); })}>No spend</button>
              <button className="btn" style={{ height: "var(--h-sm)" }} onClick={() => setForm({ ...emptyDraft(today, lastAccount() ?? ""), date: d })}>Add</button>
            </div>
          ))}
       </>}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {form && <EntrySheet initial={form} via="manual" onClose={() => setForm(null)} />}
    </>
  );
}
