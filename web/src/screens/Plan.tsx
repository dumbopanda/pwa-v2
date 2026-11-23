import { setBudget, copyBudgets } from "../lib/actions";
import { Empty, toast, useAction } from "../components";
import { useLedger, useToday } from "../lib/hooks";
import { addMonths, monthOf, spendBy } from "../lib/ledger";
import { amountText } from "../lib/entryRows";
import { formatMoney, parseAmount } from "../lib/money";
import { buildPlan } from "../lib/plan";
import { monthLabel } from "../lib/reviewFacts";

export default function Plan({ ym, onReview }: { ym: string; onReview: (ym: string) => void }) {
  const L = useLedger(); const today = useToday();
  const { busy, error, run } = useAction();
  const cur = L.s.currency;
  const plan = buildPlan(L.entries, L.accounts, L.s.budgets, ym, today, cur);
  const m = (n: number) => formatMoney(n, cur);
  const row = (id: string | null) => L.s.budgets.find((b) => b.month === `${ym}-01` && b.category_id === id);
  const byCat = new Map(spendBy(L.entries, L.accounts, ym, cur, (e) => e.category_id ?? "").map((x) => [x.key, x.spent]));
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
  const pct = (v: number, max: number) => (max > 0 ? Math.min(100, Math.round((v / max) * 100)) : 0);
  const budgeted = L.activeCategories.flatMap((c) => { const r = plan.rows.find((x) => x.category_id === c.id); return r && r.budget > 0 ? [{ c, r }] : []; })
    .sort((a, b) => b.r.spent / b.r.budget - a.r.spent / a.r.budget);        // closest to the limit first
  const rest = L.activeCategories.filter((c) => !plan.rows.some((x) => x.category_id === c.id && x.budget > 0));
  const input = (id: string | null, label: string, ph: string, width = 104) => {
    const b = row(id);
    return <input className="planin" style={{ width }} inputMode="decimal" placeholder={ph} aria-label={label} disabled={busy}
      key={`${id}${ym}${b?.amount_minor}`} defaultValue={b ? amountText(b.amount_minor, cur) : ""} onBlur={(e) => commit(id, e.target.value)} />;
  };

  return (
    <main className="screen stack" style={{ gap: "var(--sp-5)" }}>
      {/* 1. The answer: what is left, and what is safe today. */}
      <section className="planhero" aria-label="This month">
        {plan.budgetTotal === 0 ? (
          <>
            <span className="hkey">Budget for {monthLabel(ym)}</span>
            <div className="hval">Not set</div>
            <p className="planhint">Give any category a budget below. This turns into what you can spend each day.</p>
          </>
        ) : (
          <>
            <span className="hkey">{plan.left < 0 ? "Over budget by" : "Left to spend"}</span>
            <div className={`hval ${plan.left < 0 ? "neg" : ""}`}>{m(Math.abs(plan.left))}</div>
            <div className="planbar" role="presentation"><span className={plan.left < 0 ? "over" : ""} style={{ width: `${pct(plan.spentTotal, plan.budgetTotal)}%` }} /></div>
            <div className="planfacts">
              <div><span>Spent</span><b>{m(plan.spentTotal)}</b></div>
              <div><span>Budget</span><b>{m(plan.budgetTotal)}</b></div>
              {isCurrent && plan.daysLeft > 0 && <div><span>Safe a day</span><b>{m(plan.safeDaily)}</b></div>}
            </div>
          </>
        )}
      </section>

      {/* 2. The goal. */}
      <section className="card plancard" aria-label="Savings goal">
        <div className="planhead"><b>Savings goal</b>{input(null, "Savings goal amount", "Set goal")}</div>
        {plan.savingsTarget !== null && plan.savingsTarget > 0 && (
          <>
            <div className="bar" role="presentation"><span style={{ width: `${pct(plan.saved, plan.savingsTarget)}%` }} /></div>
            <p className="plannote">{m(plan.saved)} saved{plan.leftToSave! > 0 ? ` · ${m(plan.leftToSave!)} to go` : " · Goal reached"}</p>
          </>
        )}
      </section>

      {/* 3. Where the budget goes: closest to the limit first. */}
      <section className="stack" style={{ gap: "var(--sp-3)" }} aria-label="Budgets by category">
        <div className="row"><span className="caps grow">Budgets</span>
          {prevHas && !budgeted.length && <button className="btn quiet" disabled={busy} onClick={() => run(() => copyBudgets(`${addMonths(ym, -1)}-01`, `${ym}-01`))}>Copy last month</button>}
        </div>
        {L.activeCategories.length === 0 && <Empty>Add categories in Settings.</Empty>}
        {budgeted.length > 0 && (
          <div className="card plancard planlist">
            {budgeted.map(({ c, r }) => (
              <div key={c.id} className="planrow">
                <div className="planline"><span className="planname">{c.name}</span>
                  <b className={r.over ? "over" : ""}>{r.over ? `${m(-r.left)} over` : `${m(r.left)} left`}</b></div>
                <div className="bar" role="presentation"><span className={r.over ? "over" : ""} style={{ width: `${pct(r.spent, r.budget)}%` }} /></div>
                <div className="planline sub"><span>Spent {m(r.spent)} of</span>{input(c.id, `${c.name} budget`, "Budget", 96)}</div>
              </div>
            ))}
          </div>
        )}
        {rest.length > 0 && (
          <>
            {budgeted.length > 0 && <span className="caps">No budget yet</span>}
            <div className="card plancard planlist">
              {rest.map((c) => (
                <div key={c.id} className="planrow flat">
                  <div className="planline"><span className="planname">{c.name}</span>
                    {input(c.id, `${c.name} budget`, "Set budget", 96)}</div>
                  {(byCat.get(c.id) ?? 0) > 0 && <span className="plannote">Spent {m(byCat.get(c.id)!)} so far</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" onClick={() => onReview(ym)}>Open {monthLabel(ym)} review</button>
    </main>
  );
}
