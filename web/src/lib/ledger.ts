// Plain, tested code for every number on screen. Integer minor units only.
import type { Account, Entry } from "./types";

export const OPENING = "Opening balance";

const live = (e: Entry) => !e.deleted_at;
/** Money you actually spent: not a transfer, not an opening balance, not a Y-id (loan) row. */
export const isSpend = (e: Entry) => live(e) && e.direction === "debit" && !e.transfer_group && e.txn_type !== OPENING && !e.txn_id.startsWith("Y");
export const isIncome = (e: Entry) => live(e) && e.direction === "credit" && !e.transfer_group && e.txn_type !== OPENING && !e.txn_id.startsWith("Y");
/** An entry the user logged: counts toward "logged" for the day. Opening balances don't. */
export const isLogged = (e: Entry) => live(e) && e.txn_type !== OPENING;

export const monthOf = (isoDate: string) => isoDate.slice(0, 7);          // "2026-11"
export const monthStart = (ym: string) => `${ym}-01`;
export const daysInMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

const sumBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/** Balance of each account: credits minus debits of every live entry, transfers and opening balances included. */
export function balances(entries: Entry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (live(e)) m.set(e.account_id, (m.get(e.account_id) ?? 0) + (e.direction === "credit" ? e.amount_minor : -e.amount_minor));
  return m;
}

export type Totals = { spent: number; income: number; net: number };

/** Month totals per currency. Amounts in different currencies are never added together. */
export function monthTotals(entries: Entry[], accounts: Account[], ym: string): Map<string, Totals> {
  const cur = new Map(accounts.map((a) => [a.id, a.currency]));
  const out = new Map<string, Totals>();
  for (const e of entries) {
    if (monthOf(e.entry_date) !== ym) continue;
    const c = cur.get(e.account_id); if (!c) continue;
    const t = out.get(c) ?? { spent: 0, income: 0, net: 0 };
    if (isSpend(e)) t.spent += e.amount_minor; else if (isIncome(e)) t.income += e.amount_minor;
    t.net = t.income - t.spent;
    out.set(c, t);
  }
  return out;
}

export type Slice = { key: string; spent: number };

/** Spend grouped by a key, largest first, within one currency. */
export function spendBy(entries: Entry[], accounts: Account[], ym: string, currency: string, key: (e: Entry) => string): Slice[] {
  const cur = new Map(accounts.map((a) => [a.id, a.currency]));
  const m = new Map<string, number>();
  for (const e of entries) if (isSpend(e) && monthOf(e.entry_date) === ym && cur.get(e.account_id) === currency) m.set(key(e), (m.get(key(e)) ?? 0) + e.amount_minor);
  return [...m].map(([k, spent]) => ({ key: k, spent })).sort((a, b) => b.spent - a.spent || a.key.localeCompare(b.key));
}

/** Spend per calendar day of the month, index 0 = day 1. */
export function spendByDay(entries: Entry[], accounts: Account[], ym: string, currency: string): number[] {
  const out = new Array<number>(daysInMonth(ym)).fill(0);
  const cur = new Map(accounts.map((a) => [a.id, a.currency]));
  for (const e of entries) if (isSpend(e) && monthOf(e.entry_date) === ym && cur.get(e.account_id) === currency) out[Number(e.entry_date.slice(8)) - 1] += e.amount_minor;
  return out;
}

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type DayState = "open" | "logged" | "no_spend";

/** A day with an entry is "logged"; otherwise "no_spend" if you tapped it; otherwise "open". */
export function dayState(date: string, loggedDates: Set<string>, noSpend: Set<string>): DayState {
  return loggedDates.has(date) ? "logged" : noSpend.has(date) ? "no_spend" : "open";
}
export const loggedDatesOf = (entries: Entry[]) => new Set(entries.filter(isLogged).map((e) => e.entry_date));

/**
 * Streak: consecutive days that are logged or marked no-spend, ending today.
 * Today still being open doesn't break it yet; counting then starts yesterday.
 */
export function streak(today: string, state: (d: string) => DayState, firstDay: string): number {
  let d = state(today) === "open" ? addDays(today, -1) : today;
  let n = 0;
  while (d >= firstDay && state(d) !== "open") { n++; d = addDays(d, -1); }
  return n;
}

/** Past days (not today) with nothing logged and no no-spend mark, newest first, never before your first day. */
export function missedDays(today: string, state: (d: string) => DayState, firstDay: string, max = 7): string[] {
  const out: string[] = [];
  for (let d = addDays(today, -1), i = 0; i < 30 && d >= firstDay && out.length < max; d = addDays(d, -1), i++) if (state(d) === "open") out.push(d);
  return out;
}
export { sumBy };
