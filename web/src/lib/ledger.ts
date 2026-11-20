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

/** Balance of each account: credits minus debits of every live entry, transfers and opening balances included. `asOf` (YYYY-MM-DD) stops at that day. */
export function balances(entries: Entry[], asOf?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (live(e) && (!asOf || e.entry_date <= asOf)) m.set(e.account_id, (m.get(e.account_id) ?? 0) + (e.direction === "credit" ? e.amount_minor : -e.amount_minor));
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

export const loggedDatesOf = (entries: Entry[]) => new Set(entries.filter(isLogged).map((e) => e.entry_date));

/**
 * The first day that counts: the day you started, or the earliest account
 * balance date if that is earlier (you chose to fill those days in).
 */
export function startDay(entries: Entry[], firstDay: string): string {
  let d = firstDay;
  for (const e of entries) if (e.txn_type === "Opening balance" && (!d || e.entry_date < d)) d = e.entry_date;
  return d;
}

/** Days before today that are still open (not closed by you), newest first. Today never counts: it isn't over. */
export function openPastDays(today: string, closed: Record<string, string>, start: string): string[] {
  const out: string[] = [];
  if (!start) return out;
  for (let d = addDays(today, -1); d >= start; d = addDays(d, -1)) if (!closed[d]) out.push(d);
  return out;
}

/** How many past days of a month count, and how many of those you closed. Today never counts. */
export function closedInMonth(ym: string, today: string, closed: Record<string, string>, start: string): { days: number; closed: number } {
  let days = 0, n = 0;
  for (let i = 1; i <= daysInMonth(ym); i++) {
    const d = `${ym}-${String(i).padStart(2, "0")}`;
    if (d >= today || d < start) continue;
    days++; if (closed[d]) n++;
  }
  return { days, closed: n };
}

/** The date an account's balance starts: no payment may be dated before it. null = no opening balance. */
export function balanceDate(entries: Entry[], accountId: string): string | null {
  let d: string | null = null;
  for (const e of entries) if (e.account_id === accountId && e.txn_type === "Opening balance" && (d === null || e.entry_date < d)) d = e.entry_date;
  return d;
}

/** Added after its day was closed: the entry was created after the close time. */
export const isLate = (e: Entry, closed: Record<string, string>) => !!closed[e.entry_date] && e.created_at > closed[e.entry_date];
export { sumBy };

/** One colour family per account, by its place in your list, so an account looks the same on every screen. */
export const toneOf = (accounts: { id: string }[], id: string) => Math.max(0, accounts.findIndex((a) => a.id === id)) % 4;
