import { useState } from "react";
import { setBudget, copyBudgets } from "../lib/actions";
import { Bar, Empty, MonthNav, toast, useAction } from "../components";
import { useLedger, useToday } from "../lib/hooks";
import { addMonths, monthOf } from "../lib/ledger";
import { amountText } from "../lib/entryRows";
import { formatMoney, parseAmount } from "../lib/money";
import { buildPlan } from "../lib/plan";
import { monthLabel } from "../lib/reviewFacts";

export default function Plan({ onReview }: { onReview: (ym: string) => void }) {
  const L = useLedger(); const today = useToday();
  const [ym, setYm] = useState(monthOf(today));
  const { busy, error, run } = useAction();
  const cur = L.s.currency;
  const plan = buildPlan(L.entries, L.accounts, L.s.budgets, ym, today, cur);
  const m = (n: number) => formatMoney(n, cur);
  const row = (id: string | null) => L.s.budgets.find((b) => b.month === `${ym}-01` && b.category_id === id);
  const prevHas = L.s.budgets.some((b) => b.month === `${addMonths(ym, -1)}-01`);

  async function commit(id: string | null, value: string) {
    const v = value.trim();
    const minor = v === "" || v === "0" ? 0 : parseAmount(v, cur);
    if (minor === null) return toast(`That isn't a valid ${cur} amount`);
    const had = row(id)?.amount_minor ?? 0;
    if (minor === had) return;
    await run(() => setBudget(`${ym}-01`, id, minor));
  }

  const isCurrent = ym === monthOf(today);
  return (
    <main className="screen stack" style={{ gap: "var(--sp-4)" }}>
      <h1>Plan</h1>
      <MonthNav ym={ym} label={monthLabel(ym)} max={addMonths(monthOf(today), 1)} onChange={(d) => setYm(addMonths(ym, d))} />

      <section className="card stack" aria-label="Summary">
        <div className="grid3" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div><span className="caps">Spent</span><div className="big" style={{ fontSize: "var(--fs-2xl)" }}>{m(plan.spentTotal)}</div></div>
          <div><span className="caps">{plan.left < 0 ? "Over by" : "Left"}</span><div className="big" style={{ fontSize: "var(--fs-2xl)", color: plan.left < 0 ? "var(--red)" : undefined }}>{m(Math.abs(plan.left))}</div></div>
        </div>
        <Bar value={plan.spentTotal} max={plan.budgetTotal} over={plan.left < 0} />
        {plan.budgetTotal === 0
          ? <p className="muted small" style={{ margin: 0 }}>Set a budget for any category below to see what's safe to spend each day.</p>
          : isCurrent && plan.daysLeft > 0
            ? <p style={{ margin: 0 }}>Safe to spend: <b>{m(plan.safeDaily)}</b> a day for the next {plan.daysLeft} {plan.daysLeft === 1 ? "day" : "days"}.</p>
            : null}
        <p className="muted small" style={{ margin: 0 }}>Budgeted: {m(plan.budgetTotal)}. Everything you spend counts, even in categories without a budget.</p>
      </section>

      <section className="card stack" aria-label="Savings target">
        <b>Savings target</b>
        <input className="field" inputMode="decimal" placeholder="How much to save this month" aria-label="Savings target amount" key={`s${ym}${row(null)?.amount_minor}`}
          defaultValue={row(null) ? amountText(row(null)!.amount_minor, cur) : ""} onBlur={(e) => commit(null, e.target.value)} disabled={busy} />
        {plan.savingsTarget !== null && <p className="muted small" style={{ margin: 0 }}>Saved so far: {m(plan.saved)} (income minus spending). {plan.leftToSave! > 0 ? `${m(plan.leftToSave!)} still to set aside.` : "Target reached."}</p>}
      </section>

      <section className="card stack" aria-label="Budgets">
        <div className="row"><b className="grow">Budgets by category</b>
          {prevHas && !plan.rows.length && <button className="btn quiet" disabled={busy} onClick={() => run(() => copyBudgets(`${addMonths(ym, -1)}-01`, `${ym}-01`))}>Copy last month</button>}
        </div>
        {L.activeCategories.length === 0 && <Empty>Add categories in Settings.</Empty>}
        {L.activeCategories.map((c) => {
          const r = plan.rows.find((x) => x.category_id === c.id); const b = row(c.id);
          return (
            <div key={c.id} className="stack" style={{ gap: 4 }}>
              <div className="row">
                <span className="grow">{c.name}</span>
                <input className="field inset" style={{ width: 120, height: "var(--h-sm)", textAlign: "right" }} inputMode="decimal" placeholder="No budget" aria-label={`${c.name} budget`}
                  key={`${c.id}${ym}${b?.amount_minor}`} defaultValue={b ? amountText(b.amount_minor, cur) : ""} onBlur={(e) => commit(c.id, e.target.value)} disabled={busy} />
              </div>
              {r && <><Bar value={r.spent} max={r.budget} over={r.over} />
                <span className={`small ${r.over ? "error" : "muted"}`}>{r.over ? `Over by ${m(-r.left)}` : `${m(r.left)} left`} · spent {m(r.spent)}</span></>}
            </div>
          );
        })}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" onClick={() => onReview(ym)}>Open {monthLabel(ym)} review</button>
    </main>
  );
}
