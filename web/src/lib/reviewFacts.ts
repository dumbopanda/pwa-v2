// Builds the numbers the month-end review is written from. Every figure is
// computed here and formatted here; the AI only ever copies them.
import type { ReviewFacts } from "../../../supabase/functions/_shared/review.ts";
import { formatMoney } from "./money";
import { daysInMonth, loggedDatesOf, monthOf, monthTotals, spendBy } from "./ledger";
import { buildPlan } from "./plan";
import type { Account, Budget, Category, Entry } from "./types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

export function reviewFacts(entries: Entry[], accounts: Account[], categories: Category[], budgets: Budget[],
  noSpend: Set<string>, ym: string, today: string, currency: string): ReviewFacts {
  const t = monthTotals(entries, accounts, ym).get(currency) ?? { spent: 0, income: 0, net: 0 };
  const plan = buildPlan(entries, accounts, budgets, ym, today, currency);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  const m = (n: number) => formatMoney(n, currency);
  const days = [...loggedDatesOf(entries)].filter((d) => monthOf(d) === ym).length;

  const cats = spendBy(entries, accounts, ym, currency, (e) => e.category_id ?? "").slice(0, 8).map((s) => {
    const row = plan.rows.find((r) => r.category_id === s.key);
    return {
      name: s.key ? name.get(s.key) ?? "Other" : "Uncategorised", spent: m(s.spent),
      budget: row ? m(row.budget) : null, over_by: row?.over ? m(row.spent - row.budget) : null,
    };
  });
  const places = spendBy(entries, accounts, ym, currency, (e) => e.expense_name.trim().toLowerCase()).slice(0, 5)
    .map((s) => ({ name: s.key, spent: m(s.spent) }));

  return {
    month: monthLabel(ym), currency, spent: m(t.spent), income: m(t.income), net: m(t.net),
    savings_target: plan.savingsTarget === null ? null : m(plan.savingsTarget),
    left_to_save: plan.leftToSave === null ? null : m(plan.leftToSave),
    days_logged: days, days_in_month: daysInMonth(ym),
    no_spend_days: [...noSpend].filter((d) => monthOf(d) === ym).length,
    categories: cats, top_places: places,
  };
}
