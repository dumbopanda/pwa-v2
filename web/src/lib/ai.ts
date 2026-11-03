import { supabase } from "../supabase";
import type { Proposal } from "../../../supabase/functions/_shared/parse.ts";
import type { ReviewFacts, ReviewText } from "../../../supabase/functions/_shared/review.ts";
import { amountText, emptyDraft, type Draft } from "./entryRows";
import { normName } from "./ledger";
import type { Account, Category } from "./types";

export type AiFail = { reason: "daily_cap" | "minute_cap" | "unavailable"; retryAfter?: number };

async function call<T>(fn: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; fail: AiFail }> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (!error) return { ok: true, data: data as T };
  let b: { error?: string; retry_after_s?: number } = {};
  try { b = await (error as unknown as { context: Response }).context.json(); } catch { /* network or non-JSON */ }
  const reason = b.error === "daily_cap" || b.error === "minute_cap" ? b.error : "unavailable";
  return { ok: false, fail: { reason, retryAfter: b.retry_after_s } };
}

/** Sends only the text, your own account and category names, and today's date. */
export const parseText = (text: string, accounts: Account[], categories: Category[], today: string) =>
  call<{ proposal: Proposal }>("parse-entry", { text, accounts: accounts.map((a) => a.name), categories: categories.map((c) => c.name), today });

export const writeReview = (facts: ReviewFacts) => call<{ review: ReviewText }>("month-review", { facts });

export function failMessage(f: AiFail): string {
  if (f.reason === "daily_cap") return "You've used today's AI reads. Add it by hand — that always works.";
  if (f.reason === "minute_cap") return `Slow down a little${f.retryAfter ? ` — try again in ${f.retryAfter}s` : ""}. Or add it by hand.`;
  return "The AI isn't available right now. Add it by hand.";
}

/**
 * Turn the model's proposal into a form draft. Picks a sensible account when
 * the text named none, and never lets an amount sit on an account of another
 * currency.
 */
export function proposalToDraft(p: Proposal, accounts: Account[], categories: Category[], lastAccountId: string | null, today: string):
  { draft: Draft; hint?: string; assumedAccount: boolean } {
  const byName = (n: string | null) => (n ? accounts.find((a) => normName(a.name) === normName(n)) : undefined);
  const base = emptyDraft(today);
  const to = byName(p.transfer_to), named = byName(p.account);

  if (to && named) {
    return { draft: { ...base, transfer: true, accountId: named.id, toAccountId: to.id, amount: p.amount_minor ? amountText(p.amount_minor, named.currency) : "", date: p.date, note: p.note ?? "" }, assumedAccount: false };
  }

  let account = named ?? accounts.find((a) => a.id === lastAccountId) ?? (accounts.length === 1 ? accounts[0] : undefined);
  const assumed = !named && !!account;
  let hint: string | undefined;
  if (p.currency && account && account.currency !== p.currency) {
    const match = accounts.find((a) => a.currency === p.currency);
    hint = match ? undefined : `That's in ${p.currency}. Add or pick a ${p.currency} account.`;
    account = match;
  }
  const currency = account?.currency ?? p.currency ?? "INR";
  const cat = p.category ? categories.find((c) => normName(c.name) === normName(p.category!)) : undefined;
  return {
    draft: { ...base, direction: p.direction, amount: p.amount_minor ? amountText(p.amount_minor, currency) : "", accountId: account?.id ?? "",
      categoryId: cat?.id ?? "", name: p.name, note: p.note ?? "", date: p.date },
    hint: hint ?? (p.confidence < 0.5 ? "Not sure about this one. Please check it." : undefined),
    assumedAccount: assumed,
  };
}
