// Scoring for the quick-log evals. Pure, so it can be unit-tested without a model.
import type { Proposal } from "../supabase/functions/_shared/parse.ts";

export type Expect = {
  amount_minor: number | null; direction: "spent" | "received"; date: string;
  category?: string | null; account?: string | null; currency?: string; transfer_to?: string;
};
export type Case = { tag: string; text: string; expect: Expect };

export type Result = {
  text: string; tag: string;
  amount: boolean; direction: boolean; date: boolean;
  category: boolean | null; account: boolean | null; currency: boolean; transfer: boolean;
};

export function scoreCase(c: Case, p: Proposal | null): Result {
  const e = c.expect;
  const bad = { text: c.text, tag: c.tag, amount: false, direction: false, date: false,
    category: e.category === undefined ? null : false, account: e.account === undefined ? null : false, currency: false, transfer: false };
  if (!p) return bad;
  return {
    text: c.text, tag: c.tag,
    amount: p.amount_minor === e.amount_minor,
    direction: p.direction === e.direction,
    date: p.date === e.date,
    category: e.category === undefined ? null : p.category === e.category,
    account: e.account === undefined ? null : p.account === e.account,
    // No stated currency: the model must leave it blank, or say INR, so the account's own currency applies.
    currency: e.currency ? p.currency === e.currency : p.currency === null || p.currency === "INR",
    transfer: (p.transfer_to ?? undefined) === e.transfer_to,
  };
}

const pct = (xs: (boolean | null)[]) => {
  const v = xs.filter((x): x is boolean => x !== null);
  return v.length ? Math.round((1000 * v.filter(Boolean).length) / v.length) / 10 : 100;
};

export function summarize(rs: Result[]) {
  return {
    cases: rs.length,
    amount_pct: pct(rs.map((r) => r.amount)),
    category_pct: pct(rs.map((r) => r.category)),
    direction_pct: pct(rs.map((r) => r.direction)),
    account_pct: pct(rs.map((r) => r.account)),
    date_pct: pct(rs.map((r) => r.date)),
    currency_pct: pct(rs.map((r) => r.currency)),
    transfer_pct: pct(rs.map((r) => r.transfer)),
  };
}

export const TARGETS = { amount_pct: 95, category_pct: 85 };
