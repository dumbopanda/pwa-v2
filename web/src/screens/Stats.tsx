import { useState } from "react";
import { Bar, Empty, MonthNav } from "../components";
import { useLedger, useToday } from "../lib/hooks";
import { addMonths, monthOf, monthTotals, spendBy, spendByDay } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { monthLabel } from "../lib/reviewFacts";

export default function Stats() {
  const L = useLedger(); const today = useToday();
  const [ym, setYm] = useState(monthOf(today)); const [pick, setPick] = useState<string | null>(null);

  const totals = monthTotals(L.entries, L.accounts, ym);
  const currencies = [...new Set(L.accounts.map((a) => a.currency))];
  const currency = pick && currencies.includes(pick) ? pick : totals.size ? [...totals.keys()].sort((a, b) => a === L.s.currency ? -1 : b === L.s.currency ? 1 : a.localeCompare(b))[0] : L.s.currency;
  const t = totals.get(currency) ?? { spent: 0, income: 0, net: 0 };
  const m = (n: number) => formatMoney(n, currency);

  const cats = spendBy(L.entries, L.accounts, ym, currency, (e) => e.category_id ?? "");
  const accs = spendBy(L.entries, L.accounts, ym, currency, (e) => e.account_id);
  const places = spendBy(L.entries, L.accounts, ym, currency, (e) => e.expense_name.trim().toLowerCase()).slice(0, 5);
  const perDay = spendByDay(L.entries, L.accounts, ym, currency);
  const maxDay = Math.max(...perDay, 0);

  return (
    <main className="screen stack" style={{ gap: "var(--sp-4)" }}>
      <h1>Stats</h1>
      <MonthNav ym={ym} label={monthLabel(ym)} max={monthOf(today)} onChange={(d) => setYm(addMonths(ym, d))} />
      {currencies.length > 1 && <div className="chips">{currencies.map((c) => <button key={c} className="chip" aria-pressed={c === currency} onClick={() => setPick(c)}>{c}</button>)}</div>}

      <div className="grid3">
        <div className="stat"><span className="caps">Spent</span><b>{m(t.spent)}</b></div>
        <div className="stat"><span className="caps">Income</span><b>{m(t.income)}</b></div>
        <div className="stat"><span className="caps">Net</span><b>{t.net < 0 ? "−" : ""}{m(Math.abs(t.net))}</b></div>
      </div>

      {t.spent === 0 && t.income === 0 ? <Empty>No entries in {monthLabel(ym)}.</Empty> : (
        <>
          <section className="card stack" aria-label="By day">
            <b>By day</b>
            <div className="chart" role="img" aria-label={`Spending by day. Highest day ${m(maxDay)}.`}>
              {perDay.map((v, i) => <span key={i} className={ym === monthOf(today) && i + 1 === Number(today.slice(8)) ? "today" : ""} style={{ height: maxDay ? `${Math.max(2, (v / maxDay) * 100)}%` : "2px" }} title={`${i + 1}: ${m(v)}`} />)}
            </div>
            <div className="row muted small" style={{ justifyContent: "space-between" }}><span>1</span><span>{perDay.length}</span></div>
          </section>

          <section className="card stack" aria-label="By category">
            <b>By category</b>
            {cats.map((c) => (
              <div key={c.key} className="stack" style={{ gap: 4 }}>
                <div className="row"><span className="grow">{c.key ? L.categoryById.get(c.key)?.name ?? "Other" : "No category"}</span><b>{m(c.spent)}</b></div>
                <Bar value={c.spent} max={cats[0].spent} />
              </div>
            ))}
            {!cats.length && <span className="muted small">No spending.</span>}
          </section>

          <section className="card stack" aria-label="By account">
            <b>By account</b>
            {accs.map((a) => <div key={a.key} className="row"><span className="grow">{L.accountById.get(a.key)?.name ?? "?"}</span><b>{m(a.spent)}</b></div>)}
          </section>

          <section className="card stack" aria-label="Top places">
            <b>Top places and names</b>
            {places.map((p, i) => <div key={p.key} className="row"><span className="muted" style={{ width: 20 }}>{i + 1}</span><span className="grow" style={{ textTransform: "capitalize" }}>{p.key}</span><b>{m(p.spent)}</b></div>)}
          </section>
        </>
      )}
      <p className="muted small" style={{ margin: 0 }}>Transfers between your accounts and opening balances aren't counted as spending or income.</p>
    </main>
  );
}
