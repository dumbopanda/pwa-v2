import type { Account, Category, Entry } from "./types";

const HEAD = ["date", "account", "currency", "name", "category", "direction", "amount", "note", "type", "transfer", "id"];

/** One CSV cell. Quotes when needed; a leading = + - @ is defused so spreadsheets don't run it as a formula. */
export function cell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** All of a user's live entries, oldest first. Amounts are written from integer minor units, never via floats. */
export function entriesCsv(entries: Entry[], accounts: Account[], categories: Category[], digitsOf: (cur: string) => number): string {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const rows = entries.filter((e) => !e.deleted_at)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at))
    .map((e) => {
      const a = acc.get(e.account_id);
      const d = digitsOf(a?.currency ?? "INR");
      const s = String(e.amount_minor).padStart(d + 1, "0");
      const amount = d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s;
      return [e.entry_date, a?.name ?? "", a?.currency ?? "", e.expense_name, e.category_id ? cat.get(e.category_id) ?? "" : "",
        e.direction === "debit" ? "out" : "in", amount, e.more_info ?? "", e.txn_type, e.transfer_group ?? "", e.id].map(cell).join(",");
    });
  return [HEAD.join(","), ...rows].join("\r\n") + "\r\n";
}
