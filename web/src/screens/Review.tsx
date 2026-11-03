import { useEffect, useMemo, useState } from "react";
import { logEvent } from "../lib/actions";
import { failMessage, writeReview } from "../lib/ai";
import { Bar, Empty } from "../components";
import { useLedger, useToday } from "../lib/hooks";
import { formatMoney } from "../lib/money";
import { monthLabel, reviewFacts } from "../lib/reviewFacts";
import { templateReview, type ReviewText } from "../../../supabase/functions/_shared/review.ts";
import { buildPlan } from "../lib/plan";
import { spendBy } from "../lib/ledger";

/**
 * Month-end review. Every number comes from plain code (the facts). The AI
 * only writes words around them; if it changes a number the reply is dropped
 * and a plain template is shown instead.
 */
export default function Review({ ym, onClose, onPlan }: { ym: string; onClose: () => void; onPlan: () => void }) {
  const L = useLedger(); const today = useToday();
  const cur = L.s.currency;
  const facts = useMemo(() => reviewFacts(L.entries, L.accounts, L.categories, L.s.budgets, L.noSpend, ym, today, cur),
    [L.entries, L.accounts, L.categories, L.s.budgets, L.noSpend, ym, today, cur]);
  const plan = buildPlan(L.entries, L.accounts, L.s.budgets, ym, today, cur);
  const cats = spendBy(L.entries, L.accounts, ym, cur, (e) => e.category_id ?? "");
  const m = (n: number) => formatMoney(n, cur);

  const [text, setText] = useState<ReviewText | null>(null);
  const [ai, setAi] = useState<"loading" | "ai" | "plain">("loading");
  const [why, setWhy] = useState<string | null>(null);
  const key = JSON.stringify(facts);

  useEffect(() => { logEvent("review_opened"); }, []);
  useEffect(() => {
    let live = true;
    setAi("loading");
    writeReview(facts).then((r) => {
      if (!live) return;
      if (r.ok) { setText(r.data.review); setAi("ai"); }
      else { setText(templateReview(facts)); setAi("plain"); setWhy(failMessage(r.fail).replace(/ Add it by hand.*| Or add it by hand\./, "")); }
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const over = plan.rows.filter((r) => r.over);
  return (
    <main className="screen stack" style={{ gap: "var(--sp-4)" }}>
      <div className="row"><button className="btn icon" aria-label="Back" onClick={onClose}>‹</button><div><div className="caps">Month-end review</div><h1>{monthLabel(ym)}</h1></div></div>

      <div className="grid3">
        <div className="stat"><span className="caps">Spent</span><b>{facts.spent}</b></div>
        <div className="stat"><span className="caps">Income</span><b>{facts.income}</b></div>
        <div className="stat"><span className="caps">Net</span><b>{facts.net}</b></div>
      </div>

      <section className="card stack" aria-label="Summary">
        {ai === "loading" ? <p className="muted" style={{ margin: 0 }}>Writing your summary…</p> : (
          <>
            <p style={{ margin: 0 }}>{text!.summary}</p>
            <div className="caps">Ideas for next month</div>
            <ol style={{ margin: 0, paddingLeft: "var(--sp-5)" }}>{text!.suggestions.map((s) => <li key={s}>{s}</li>)}</ol>
            <p className="muted small" style={{ margin: 0 }}>{ai === "ai" ? "Written by AI from the numbers on this page. It never calculates." : `Written without AI${why ? ` (${why})` : ""}.`}</p>
          </>
        )}
      </section>

      <section className="card stack" aria-label="Where the money went">
        <b>Where the money went</b>
        {cats.length === 0 && <Empty>No spending this month.</Empty>}
        {cats.map((c) => <div key={c.key} className="stack" style={{ gap: 4 }}>
          <div className="row"><span className="grow">{c.key ? L.categoryById.get(c.key)?.name ?? "Other" : "No category"}</span><b>{m(c.spent)}</b></div><Bar value={c.spent} max={cats[0].spent} /></div>)}
      </section>

      <section className="card stack" aria-label="Against your plan">
        <b>Against your plan</b>
        {plan.rows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No budgets were set for this month.</p>
          : over.length === 0 ? <p style={{ margin: 0 }}>Every budgeted category stayed within plan.</p>
          : over.map((r) => <div key={r.category_id} className="row"><span className="grow">{L.categoryById.get(r.category_id)?.name}</span><b className="error">over by {m(-r.left)}</b></div>)}
        {plan.savingsTarget !== null && <div className="row"><span className="grow">Savings target {m(plan.savingsTarget)}</span><b>{plan.leftToSave! > 0 ? `${m(plan.leftToSave!)} left to save` : "reached"}</b></div>}
        <div className="muted small">Logged {facts.days_logged} of {facts.days_in_month} days · {facts.no_spend_days} no-spend {facts.no_spend_days === 1 ? "day" : "days"}</div>
      </section>

      <button className="btn primary" onClick={onPlan}>Plan next month</button>
    </main>
  );
}
