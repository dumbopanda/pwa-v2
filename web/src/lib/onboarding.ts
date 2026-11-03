import { parseAmount } from "./money";
import { newTxnId } from "./ids";

export const SUGGESTED_ACCOUNTS = ["UPI bank", "Cash", "Credit card", "Salary account"];

// Picked by default: the ones most people use in a month.
export const DEFAULT_CATEGORIES: { name: string; on: boolean }[] = [
  { name: "Food & dining", on: true },
  { name: "Groceries", on: true },
  { name: "Transport", on: true },
  { name: "Fuel", on: false },
  { name: "Shopping", on: true },
  { name: "Bills & utilities", on: true },
  { name: "Rent", on: false },
  { name: "Health", on: true },
  { name: "Education", on: false },
  { name: "Entertainment", on: true },
  { name: "Travel", on: false },
  { name: "Personal care", on: false },
  { name: "Subscriptions", on: false },
  { name: "Family", on: false },
  { name: "Gifts & donations", on: false },
  { name: "Salary", on: true },
  { name: "Refund", on: false },
  { name: "Other income", on: false },
  { name: "Other", on: true },
];

export type AccountDraft = {
  uid: string;        // client_uid, kept across retries so a re-save is idempotent
  balanceUid: string; // client_uid of its opening-balance entry
  name: string;
  currency: string;
  balance: string;    // as typed; empty = zero
  owe: boolean;       // "I owe this" (credit card): balance is negative
};

/** One error message per draft (null = fine), plus a form-level error. */
export function validateAccounts(drafts: AccountDraft[]): { rows: (string | null)[]; form: string | null } {
  const seen = new Set<string>();
  const rows = drafts.map((d) => {
    const name = d.name.trim();
    if (!name) return "Give it a name";
    if (name.length > 40) return "Keep the name under 40 letters";
    const key = name.toLowerCase();
    if (seen.has(key)) return "Two accounts can't share a name";
    seen.add(key);
    if (d.balance.trim() && d.balance.trim() !== "0" && parseAmount(d.balance, d.currency) === null)
      return "That balance doesn't look like an amount";
    return null;
  });
  return { rows, form: drafts.length ? null : "Add at least one account" };
}

/**
 * Opening balance rows for push_entries (Android rule): one ordinary row per
 * account, "Opening balance" name and type, credit if you have money, debit
 * if you owe it. Zero means no row.
 */
export function openingBalanceRows(drafts: AccountDraft[], accountIds: Map<string, string>, today: string) {
  return drafts.flatMap((d) => {
    const minor = d.balance.trim() ? parseAmount(d.balance, d.currency) : null;
    const id = accountIds.get(d.uid);
    if (!minor || !id) return [];
    return [{
      client_uid: d.balanceUid,
      entry_date: today,
      txn_id: newTxnId("N"),
      account_id: id,
      category_id: null,
      expense_name: "Opening balance",
      txn_type: "Opening balance",
      amount_minor: minor,
      direction: d.owe ? "debit" : "credit",
    }];
  });
}
