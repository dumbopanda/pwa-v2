// Writes. Each needs a connection and throws a plain Error the screen can show.
import { supabase } from "../supabase";
import { entriesCsv } from "./csv";
import { draftRows, type Draft, type Row } from "./entryRows";
import { newUid, todayLocal } from "./ids";
import { openingBalanceRows } from "./onboarding";
import { currencyDigits, parseAmount } from "./money";
import { applyLocal, closeUser, getState, sync } from "./store";
import type { Account, Category, Entry } from "./types";

const fail = (m: string): never => { throw new Error(m); };
const NET = "Couldn't reach the server. Nothing was saved. Try again when you're online.";

type Pushed = { client_uid: string; id: string; updated_at: string }[];

async function push(rows: Row[]): Promise<Entry[]> {
  const { data, error } = await supabase.rpc("push_entries", { p_rows: rows });
  if (error) {
    if (error.code === "P0002") fail("You've reached the entry limit. Export your data and contact support.");
    if (error.code === "P0001") fail("That transfer didn't look right, so it wasn't saved.");
    if (error.code === "23503") fail("That account or category no longer exists. Pull down to refresh.");
    if (error.code === "P0005") fail("That date is before this account's balance starts. Pick a later date.");
    return fail(NET);
  }
  const now = new Date().toISOString();
  const got = new Map((data as Pushed).map((r) => [r.client_uid, r]));
  const had = new Map(getState().entries.map((e) => [e.client_uid, e.created_at]));   // an edit keeps its original created time ("Late" depends on it)
  return rows.map((r) => ({ ...r, id: got.get(r.client_uid)!.id, updated_at: got.get(r.client_uid)!.updated_at, created_at: had.get(r.client_uid) ?? now, deleted_at: r.deleted_at } as Entry));
}

/** Save a new entry or transfer (or an edit, when `existing` is given). Returns the saved entries. */
export async function saveDraft(d: Draft, minor: number, existing?: Entry): Promise<Entry[]> {
  const rows = draftRows(d, minor, getState().categories, existing);
  const saved = await push(rows);
  applyLocal({ entries: saved });
  return saved;
}

/** Soft delete. A transfer's other leg is removed by the database. */
export async function deleteEntry(e: Entry): Promise<void> {
  const { id: _i, created_at: _c, updated_at: _u, ...row } = e;
  const saved = await push([{ ...row, deleted_at: new Date().toISOString() } as Row]);
  applyLocal({ entries: saved.map((s) => ({ ...e, ...s })) });
  if (e.transfer_group) void sync();
}

/** Undo a delete just made (the whole transfer for a transfer). */
export async function undoDelete(e: Entry): Promise<void> {
  const q = supabase.from("entries").update({ deleted_at: null });
  const { error } = await (e.transfer_group ? q.eq("transfer_group", e.transfer_group) : q.eq("id", e.id));
  if (error) fail(NET);
  await sync();
}

/** "Every payment for this day is added." Needs a connection. A future day can't be closed. */
export async function closeDay(date: string): Promise<void> {
  const { data, error } = await supabase.from("day_status").upsert({ date }, { onConflict: "user_id,date", ignoreDuplicates: true }).select("date, created_at");
  if (error) fail(error.code === "42501" ? "You can't close a day that hasn't happened yet." : NET);
  const at = (data as { created_at: string }[] | null)?.[0]?.created_at ?? getState().closed[date] ?? new Date().toISOString();
  applyLocal({ closed: { ...getState().closed, [date]: at } });
}

/** Reopen a closed day. Only the same day: once it is over, a closed day stays closed (the database enforces it). */
export async function reopenDay(date: string): Promise<void> {
  const { data, error } = await supabase.from("day_status").delete().eq("date", date).select("date");
  if (error) fail(NET);
  if (!data?.length) { await sync(); fail("A day can't be reopened once it is over."); }
  const { [date]: _gone, ...rest } = getState().closed;
  applyLocal({ closed: rest });
}

/** Set, change or clear a monthly budget. categoryId null = the savings target. amount 0 clears it. */
export async function setBudget(month: string, categoryId: string | null, amountMinor: number): Promise<void> {
  const cur = getState().budgets;
  const hit = cur.find((b) => b.month === month && b.category_id === categoryId);
  const res = !hit ? (amountMinor > 0 ? await supabase.from("budgets").insert({ month, category_id: categoryId, amount_minor: amountMinor }) : { error: null })
    : amountMinor > 0 ? await supabase.from("budgets").update({ amount_minor: amountMinor }).eq("id", hit.id)
    : await supabase.from("budgets").delete().eq("id", hit.id);
  if (res.error) fail(NET);
  await sync();
}

/** Copy last month's budgets (not the savings target) into a month that has none yet. */
export async function copyBudgets(from: string, to: string): Promise<void> {
  const rows = getState().budgets.filter((b) => b.month === from && b.category_id).map((b) => ({ month: to, category_id: b.category_id, amount_minor: b.amount_minor }));
  if (!rows.length) return;
  const { error } = await supabase.from("budgets").insert(rows);
  if (error) fail(NET);
  await sync();
}

/**
 * Add an account, optionally with what's in it today as an opening balance (credit if you
 * have it, debit if you owe it; same row shape as onboarding). If the balance can't be saved
 * the account is removed again, so a retry never hits "name already used".
 */
export async function addAccount(name: string, currency: string, balance = "", owe = false, asOf = todayLocal()): Promise<Account> {
  const minor = balance.trim() && balance.trim() !== "0" ? parseAmount(balance, currency) : null;
  if (balance.trim() && balance.trim() !== "0" && minor === null) fail("That balance doesn't look like an amount.");
  const sort = getState().accounts.length;
  const uid = newUid();
  const { data, error } = await supabase.from("accounts").insert({ client_uid: uid, name: name.trim(), currency, sort_order: sort }).select("*").single();
  if (error) return fail(error.code === "23505" ? "You already have an account with that name." : error.code === "P0002" ? "That's the most accounts allowed." : NET);
  const acc = data as Account;
  if (minor) {
    const rows = openingBalanceRows([{ uid, balanceUid: newUid(), name, currency, balance, owe }], new Map([[uid, acc.id]]), asOf);
    try { applyLocal({ entries: await push(rows as Row[]) }); }
    catch (e) {
      await supabase.from("accounts").update({ deleted_at: new Date().toISOString() }).eq("id", acc.id);
      throw e;
    }
  }
  applyLocal({ accounts: [acc] });
  return acc;
}
export async function updateAccount(id: string, patch: Partial<Pick<Account, "name" | "currency" | "archived_at" | "sort_order">>): Promise<void> {
  const { data, error } = await supabase.from("accounts").update(patch).eq("id", id).select("*").single();
  if (error) fail(error.code === "23505" ? "You already have an account with that name." : error.code === "P0004" ? "This account has entries, so its currency can't change." : NET);
  applyLocal({ accounts: [data as Account] });
}
export async function addCategory(name: string): Promise<Category> {
  const sort = getState().categories.length;
  const { data, error } = await supabase.from("categories").insert({ client_uid: newUid(), name: name.trim(), sort_order: sort }).select("*").single();
  if (error) return fail(error.code === "23505" ? "You already have a category with that name." : NET);
  applyLocal({ categories: [data as Category] });
  return data as Category;
}
export async function updateCategory(id: string, patch: Partial<Pick<Category, "name" | "archived_at">>): Promise<void> {
  const { data, error } = await supabase.from("categories").update(patch).eq("id", id).select("*").single();
  if (error) fail(error.code === "23505" ? "You already have a category with that name." : NET);
  applyLocal({ categories: [data as Category] });
}

let firstSaved = false;
/** Milliseconds since the app opened, for the first save of this app open only (the "time to first entry" metric). */
export function firstSaveMs(): number | undefined {
  if (firstSaved) return undefined;
  firstSaved = true;
  return Math.round(performance.now());
}

/** Usage metric. Fire and forget; never blocks or breaks the screen. Props are numbers and fixed labels only. */
export function logEvent(name: string, props: Record<string, unknown> = {}): void {
  void supabase.from("events").insert({ name, props }).then(() => undefined, () => undefined);
}

/** Every live entry as a CSV download. Built in the browser from the synced ledger. */
export async function exportCsv(): Promise<void> {
  await sync();
  const s = getState();
  const csv = entriesCsv(s.entries, s.accounts, s.categories, currencyDigits);
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `my-expenses-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Delete the account and every row it owns, then clear this device. */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) fail(NET);
  await closeUser(true);
  await supabase.auth.signOut();
}
