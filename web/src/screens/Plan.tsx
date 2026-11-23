import { useRef, useState } from "react";
import Icon from "../Icon";
import { setBudget, copyBudgets } from "../lib/actions";
import { Empty, toast, useAction } from "../components";
import { useLedger, useToday } from "../lib/hooks";
import { addMonths, daysInMonth, isSpend, monthOf, spendBy } from "../lib/ledger";
import { amountText } from "../lib/entryRows";
import { formatMoney, parseAmount } from "../lib/money";
import { buildPlan } from "../lib/plan";
import { monthLabel } from "../lib/reviewFacts";

export default function Plan({ ym, onReview }: { ym: string; onReview: (ym: string) => void }) {
  const L = useLedger(); const today = useToday();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);   // a category id, or "goal"
  const cancelled = useRef(false);
  const cur = L.s.currency;
  const plan = buildPlan(L.entries, L.accounts, L.s.budgets, ym, today, cur);
  const m = (n: number) => formatMoney(n, cur);
  const row = (id: string | null) => L.s.budgets.find((b) => b.month === `${ym}-01` && b.category_id === id);
  const prevHas = L.s.budgets.some((b) => b.month === `${addMonths(ym, -1)}-01`);
  const isCurrent = ym === monthOf(today);

  async function commit(id: string | null, value: string) {
    setEditing(null);
    const v = value.trim();
    const minor = v === "" || v === "0" ? 0 : parseAmount(v, cur);
    if (minor === null) return toast(`That isn't a valid ${cur} amount`);
    if (minor === (row(id)?.amount_minor ?? 0)) return;
    await run(() => setBudget(`${ym}-01`, id, minor));
  }

  // One bar per day against the daily pace (budget / days in the month).
  const total = daysInMonth(ym);
  const todayN = today.startsWith(ym) ? Number(today.slice(8)) : today < ym ? 0 : total + 1;
  const perDay = Array.from({ length: total }, () => 0);
  for (const e of L.entries) if (isSpend(e) && monthOf(e.entry_date) === ym && L.accountById.get(e.account_id)?.currency === cur) perDay[Number(e.entry_date.slice(8)) - 1] += e.amount_minor;
  const pace = plan.budgetTotal > 0 ? plan.budgetTotal / total : 0;
  const scale = Math.max(pace * 1.6, ...perDay, 1);

  const byCat = new Map(spendBy(L.entries, L.accounts, ym, cur, (e) => e.category_id ?? "").map((x) => [x.key, x.spent]));
  const rowOf = (cid: string) => plan.rows.find((x) => x.category_id === cid && x.budget > 0);
  const shown = L.activeCategories.filter((c) => rowOf(c.id) || editing === c.id)
    .sort((a, b) => { const ra = rowOf(a.id), rb = rowOf(b.id); return (rb ? rb.spent / rb.budget : 0) - (ra ? ra.spent / ra.budget : 0); });   // closest to the limit first
  const addable = L.activeCategories.filter((c) => !rowOf(c.id) && editing !== c.id);
  const pct = (v: number, max: number) => (max > 0 ? Math.min(100, (v / max) * 100) : 0);

  const sym = m(0).replace(/[\d.,\s]/g, "");   // "₹", "$", ...
  // ✓ saves, ✕ drops the edit. Buttons keep focus on the box so a tap doesn't trigger the blur-save first.
  const field = (id: string | null, label: string) => {
    const keep = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); };
    return (
      <span className="pedit" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pok" aria-label="Save" onPointerDown={keep} onClick={() => document.getElementById("planin")?.blur()}><Icon name="check" size={22} /></button>
        <button type="button" className="pno" aria-label="Cancel" onPointerDown={keep} onClick={() => { cancelled.current = true; setEditing(null); }}><Icon name="close" size={22} /></button>
        <span className="planbox"><b aria-hidden="true">{sym}</b>
          <input id="planin" className="planin" autoFocus inputMode="decimal" placeholder="Amount" aria-label={label}
            defaultValue={row(id) ? amountText(row(id)!.amount_minor, cur) : ""}
            onBlur={(e) => { if (cancelled.current) cancelled.current = false; else commit(id, e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { cancelled.current = true; setEditing(null); } }} />
        </span>
      </span>
    );
  };

  const goal = plan.savingsTarget ?? 0;
  return (
    <main className="screen stack" style={{ gap: "var(--sp-5)" }}>
      {/* The one number. */}
      <header className="pnum">
        {plan.budgetTotal === 0 ? (
          <><span className="pk">Plan for {monthLabel(ym)}</span><b className="pv dim">No budget yet</b><p className="ps">Give a category a budget below. This becomes what you can spend each day.</p></>
        ) : isCurrent && plan.left > 0 ? (
          <><span className="pk">You can spend today</span><b className="pv">{m(plan.safeDaily)}</b>
            <p className="ps">{m(plan.left)} left of {m(plan.budgetTotal)} · {plan.daysLeft} {plan.daysLeft === 1 ? "day" : "days"} to go</p></>
        ) : (
          <><span className="pk">{plan.left < 0 ? "Over budget by" : "Left this month"}</span><b className={`pv ${plan.left < 0 ? "over" : ""}`}>{m(Math.abs(plan.left))}</b>
            <p className="ps">Spent {m(plan.spentTotal)} of {m(plan.budgetTotal)}</p></>
        )}
      </header>

      {/* The month, day by day, against the pace. */}
      {plan.budgetTotal > 0 && (
        <figure className="pdays" aria-label="Spending by day">
          <div className="pbars">
            {perDay.map((v, i) => (
              <i key={i} className={i + 1 === todayN ? "now" : i + 1 > todayN ? "later" : v > pace ? "hot" : ""} style={{ height: `${Math.max(pct(v, scale), 3)}%` }} />
            ))}
            <span className="ppace" style={{ bottom: `${pct(pace, scale)}%` }} />
          </div>
          <figcaption><span>1</span><span>Daily pace {m(Math.round(pace))}</span><span>{total}</span></figcaption>
        </figure>
      )}

      {/* Budgets: each row fills as the money goes. Tap to change. */}
      <section className="stack" style={{ gap: "var(--sp-2)" }} aria-label="Budgets">
        {L.activeCategories.length === 0 && <Empty>Add categories in your Profile.</Empty>}
        {shown.map((c) => {
          const r = rowOf(c.id); const used = r ? r.spent / r.budget : 0;
          return (
            <div key={c.id} className="prow" role="button" tabIndex={0} aria-label={`${c.name} budget`} onClick={() => setEditing(c.id)} onKeyDown={(e) => e.key === "Enter" && setEditing(c.id)}>
              {r && <i className={r.over ? "over" : used >= .85 ? "warn" : ""} style={{ width: `${pct(r.spent, r.budget)}%` }} />}
              <span className="pl"><b>{c.name}</b>{r && <small>Spent {m(r.spent)} of {m(r.budget)}</small>}</span>
              {editing === c.id ? field(c.id, `${c.name} budget`) : r && <b className={`pr ${r.over ? "over" : ""}`}>{r.over ? `${m(-r.left)} over` : `${m(r.left)} left`}</b>}
            </div>
          );
        })}
        {addable.length > 0 && (
          <div className="padd"><span>{shown.length ? "Also budget" : "Pick a category"}</span>
            <div className="chips">{addable.map((c) => <button key={c.id} className="fchip add" onClick={() => setEditing(c.id)}>{c.name}{(byCat.get(c.id) ?? 0) > 0 ? ` · ${m(byCat.get(c.id)!)}` : ""}</button>)}</div></div>
        )}
        {prevHas && !shown.length && <button className="btn quiet" disabled={busy} onClick={() => run(() => copyBudgets(`${addMonths(ym, -1)}-01`, `${ym}-01`))}>Copy last month's budgets</button>}
      </section>

      {/* The goal, set apart in dark. */}
      <div className="prow goal" role="button" tabIndex={0} aria-label="Savings goal" onClick={() => setEditing("goal")} onKeyDown={(e) => e.key === "Enter" && setEditing("goal")}>
        {goal > 0 && <i style={{ width: `${pct(plan.saved, goal)}%` }} />}
        <span className="pl"><b>Savings goal</b><small>{goal > 0 ? `${m(plan.saved)} saved${plan.leftToSave! > 0 ? ` · ${m(plan.leftToSave!)} to go` : " · reached"}` : "Tap to set"}</small></span>
        {editing === "goal" ? field(null, "Savings goal amount") : goal > 0 && <b className="pr">{m(goal)}</b>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn quiet" onClick={() => onReview(ym)}>Open {monthLabel(ym)} review</button>
    </main>
  );
}
