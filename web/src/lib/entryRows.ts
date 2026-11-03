// Turns what the form holds into rows for push_entries, and refuses bad input.
// All amounts become integer minor units through parseAmount.
import { newTxnId, newUid } from "./ids";
import { currencyDigits, parseAmount } from "./money";
import type { Account, Category, Entry } from "./types";

export type Draft = {
  transfer: boolean;
  direction: "spent" | "received";
  amount: string;
  accountId: string;
  toAccountId: string;      // transfers only
  categoryId: string;       // "" = none
  name: string;
  note: string;
  date: string;             // YYYY-MM-DD
};

export const emptyDraft = (today: string, accountId = ""): Draft =>
  ({ transfer: false, direction: "spent", amount: "", accountId, toAccountId: "", categoryId: "", name: "", note: "", date: today });

export type Checked = { ok: true; minor: number } | { ok: false; error: string };

export function checkDraft(d: Draft, accounts: Account[], today: string): Checked {
  const from = accounts.find((a) => a.id === d.accountId);
  if (!from) return { ok: false, error: "Pick an account" };
  const minor = parseAmount(d.amount, from.currency);
  if (minor === null) return { ok: false, error: d.amount.trim() ? `That isn't a valid ${from.currency} amount` : "Add an amount" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date < "2000-01-01") return { ok: false, error: "Pick a date" };
  if (d.date > today) return { ok: false, error: "That date is still in the future" };
  if (d.transfer) {
    const to = accounts.find((a) => a.id === d.toAccountId);
    if (!to) return { ok: false, error: "Pick the account it went to" };
    if (to.id === from.id) return { ok: false, error: "Pick two different accounts" };
    if (to.currency !== from.currency) return { ok: false, error: `${from.name} is ${from.currency} and ${to.name} is ${to.currency}. Transfers can't change currency.` };
  } else if (!d.name.trim()) return { ok: false, error: "Add a name, like where it was" };
  if (d.name.trim().length > 120) return { ok: false, error: "Keep the name under 120 letters" };
  if (d.note.length > 300) return { ok: false, error: "Keep the note under 300 letters" };
  return { ok: true, minor };
}

/** The Android type labels, kept so exports and history read the same everywhere. */
export function typeFor(direction: "spent" | "received", categoryName?: string): string {
  if (direction === "spent") return "Payment";
  const c = (categoryName ?? "").toLowerCase();
  return c === "refund" ? "Refund" : c === "salary" ? "Salary" : "Income";
}

export type Row = {
  client_uid: string; entry_date: string; txn_id: string; account_id: string; category_id: string | null;
  expense_name: string; more_info: string | null; txn_type: string; amount_minor: number;
  direction: "debit" | "credit"; transfer_group: string | null; deleted_at: string | null;
};

/** One row for an entry, or two sharing a transfer_group for a self transfer. `existing` keeps ids when editing. */
export function draftRows(d: Draft, minor: number, categories: Category[], existing?: Entry): Row[] {
  const base = { entry_date: d.date, amount_minor: minor, more_info: d.note.trim() || null, deleted_at: null };
  if (d.transfer) {
    const group = crypto.randomUUID(), txn = newTxnId("Y");
    return [
      { ...base, client_uid: newUid(), txn_id: txn, account_id: d.accountId, category_id: null, expense_name: "Self Transfer", txn_type: "Sent Transfer", direction: "debit", transfer_group: group },
      { ...base, client_uid: newUid(), txn_id: txn, account_id: d.toAccountId, category_id: null, expense_name: "Self Transfer", txn_type: "Received Transfer", direction: "credit", transfer_group: group },
    ];
  }
  const cat = categories.find((c) => c.id === d.categoryId);
  return [{
    ...base, client_uid: existing?.client_uid ?? newUid(), txn_id: existing?.txn_id ?? newTxnId("N"),
    account_id: d.accountId, category_id: cat?.id ?? null, expense_name: d.name.trim(),
    txn_type: typeFor(d.direction, cat?.name), direction: d.direction === "spent" ? "debit" : "credit", transfer_group: null,
  }];
}

/** Minor units back to the plain "340.50" the amount box holds, using the currency's own decimals. */
export function amountText(minor: number, currency: string): string {
  const d = currencyDigits(currency);
  if (!d) return String(minor);
  const s = String(minor).padStart(d + 1, "0");
  return `${s.slice(0, -d)}.${s.slice(-d)}`;
}

export function draftFromEntry(e: Entry, currency: string): Draft {
  return {
    transfer: false, direction: e.direction === "debit" ? "spent" : "received",
    amount: amountText(e.amount_minor, currency),
    accountId: e.account_id, toAccountId: "", categoryId: e.category_id ?? "", name: e.expense_name, note: e.more_info ?? "", date: e.entry_date,
  };
}
