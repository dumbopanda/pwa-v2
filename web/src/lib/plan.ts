// Budget and savings maths. Plain integers, no floats.
import type { Budget, Entry, Account } from "./types";
import { daysInMonth, isIncome, isSpend, monthOf, spendBy } from "./ledger";

export type PlanRow = { category_id: string; budget: number; spent: number; left: number; over: boolean };
export type Plan = {
  rows: PlanRow[];
  budgetTotal: number;
  spentTotal: number;         // every spend in the currency, budgeted or not: it all comes out of the same money
  left: number;               // budgetTotal - spentTotal, can be negative
  daysLeft: number;           // today included
  safeDaily: number;          // what you can spend each remaining day; 0 when nothing is left
  savingsTarget: number | null;
  saved: number;              // max(0, income - spend) so far
  leftToSave: number | null;  // max(0, target - saved)
};

export function buildPlan(entries: Entry[], accounts: Account[], budgets: Budget[], ym: string, today: string, currency: string): Plan {
  const month = budgets.filter((b) => b.month === `${ym}-01`);
  const byCat = new Map(spendBy(entries, accounts, ym, currency, (e) => e.category_id ?? "").map((s) => [s.key, s.spent]));
  const rows = month.filter((b) => b.category_id).map((b) => {
    const spent = byCat.get(b.category_id!) ?? 0;
    return { category_id: b.category_id!, budget: b.amount_minor, spent, left: b.amount_minor - spent, over: spent > b.amount_minor };
  });
  const budgetTotal = rows.reduce((a, r) => a + r.budget, 0);
  const cur = new Map(accounts.map((a) => [a.id, a.currency]));
  const inMonth = entries.filter((e) => monthOf(e.entry_date) === ym && cur.get(e.account_id) === currency);
  const spentTotal = inMonth.filter(isSpend).reduce((a, e) => a + e.amount_minor, 0);
  const income = inMonth.filter(isIncome).reduce((a, e) => a + e.amount_minor, 0);

  const total = daysInMonth(ym);
  const day = today.startsWith(ym) ? Number(today.slice(8)) : today < ym ? 1 : total + 1;
  const daysLeft = Math.max(0, total - day + 1);
  const left = budgetTotal - spentTotal;
  const savingsTarget = month.find((b) => !b.category_id)?.amount_minor ?? null;
  const saved = Math.max(0, income - spentTotal);
  return {
    rows, budgetTotal, spentTotal, left, daysLeft,
    safeDaily: daysLeft > 0 && left > 0 ? Math.floor(left / daysLeft) : 0,
    savingsTarget, saved, leftToSave: savingsTarget === null ? null : Math.max(0, savingsTarget - saved),
  };
}
