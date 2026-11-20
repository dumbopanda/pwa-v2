// Accuracy log for quick log: what the person said (text only, never audio),
// what the app read from it, and what they finally saved. Admin-only via SQL;
// deleted with the account. Bank SMS balances and account numbers are cut first.
import { redactSms } from "../../../supabase/functions/_shared/parse.ts";
import type { Draft } from "./entryRows";
import type { Account, Category } from "./types";

type Names = { accountById: Map<string, Account>; categoryById: Map<string, Category> };
export type Outcome = "accepted" | "edited" | "rejected" | "unread";

const shape = (d: Draft, n: Names) => ({
  amt: d.amount.trim(), dir: d.transfer ? "transfer" : d.direction,
  acc: n.accountById.get(d.accountId)?.name ?? "", to: d.transfer ? n.accountById.get(d.toAccountId)?.name ?? "" : "",
  cat: d.transfer ? "" : n.categoryById.get(d.categoryId)?.name ?? "", name: d.transfer ? "" : d.name.slice(0, 60), date: d.date,
});

/** The props for one "read_check" event, kept under the table's 1000-byte cap by trimming the text. */
export function readCheckProps(said: string, outcome: Outcome, source: string, today: string, read: Draft | null, saved: Draft | null, n: Names) {
  let text = redactSms(said.trim()).slice(0, 300);
  const build = () => ({ said: text, outcome, source, today, read: read ? shape(read, n) : null, saved: saved ? shape(saved, n) : null });
  while (new TextEncoder().encode(JSON.stringify(build())).length > 990 && text) text = text.slice(0, -20);
  return build();
}
