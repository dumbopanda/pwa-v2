import { describe, expect, it } from "vitest";
import { amountText, checkDraft, draftFromEntry, draftRows, emptyDraft, typeFor, type Draft } from "./entryRows";
import { parseAmount } from "./money";
import type { Account, Category, Entry } from "./types";

const acc = (id: string, currency = "INR"): Account => ({ id, client_uid: id, name: id, currency, sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" });
const accounts = [acc("bank"), acc("cash"), acc("usd", "USD"), acc("yen", "JPY")];
const cats: Category[] = [{ id: "food", client_uid: "f", name: "Food", sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" },
  { id: "ref", client_uid: "r", name: "Refund", sort_order: 1, archived_at: null, deleted_at: null, updated_at: "" }];
const TODAY = "2026-11-03";
const d = (o: Partial<Draft>): Draft => ({ ...emptyDraft(TODAY, "bank"), amount: "340", name: "Swiggy", ...o });

describe("checkDraft", () => {
  it("accepts a plain entry and returns integer minor units", () => expect(checkDraft(d({}), accounts, TODAY)).toEqual({ ok: true, minor: 34000 }));
  it.each([
    [{ accountId: "" }, "Pick an account"], [{ amount: "" }, "Add an amount"], [{ amount: "1.234" }, "valid INR"],
    [{ date: "2026-11-04" }, "future"], [{ date: "1999-01-01" }, "Pick a date"], [{ name: " " }, "Add a name"],
  ])("refuses %j", (o, msg) => {
    const r = checkDraft(d(o as Partial<Draft>), accounts, TODAY);
    expect(r.ok).toBe(false); expect(!r.ok && r.error).toContain(msg);
  });
  it("uses the account's own decimals", () => {
    expect(checkDraft(d({ accountId: "yen", amount: "500" }), accounts, TODAY)).toEqual({ ok: true, minor: 500 });
    expect(checkDraft(d({ accountId: "yen", amount: "5.5" }), accounts, TODAY).ok).toBe(false);
  });
  it("transfers need two different accounts of the same currency and no name", () => {
    const t = { transfer: true, name: "" };
    expect(checkDraft(d({ ...t, toAccountId: "cash" }), accounts, TODAY).ok).toBe(true);
    expect(checkDraft(d({ ...t, toAccountId: "bank" }), accounts, TODAY).ok).toBe(false);
    expect(checkDraft(d({ ...t, toAccountId: "" }), accounts, TODAY).ok).toBe(false);
    const r = checkDraft(d({ ...t, toAccountId: "usd" }), accounts, TODAY);
    expect(!r.ok && r.error).toContain("can't change currency");
  });
});

describe("draftRows", () => {
  it("builds one debit row for a spend", () => {
    const [r] = draftRows(d({ categoryId: "food", note: " extra " }), 34000, cats);
    expect(r).toMatchObject({ account_id: "bank", category_id: "food", expense_name: "Swiggy", txn_type: "Payment", amount_minor: 34000, direction: "debit", transfer_group: null, more_info: "extra" });
    expect(r.txn_id).toMatch(/^N[a-z0-9]{6}$/);
  });
  it("labels money received by category", () => {
    expect(typeFor("received", "Refund")).toBe("Refund"); expect(typeFor("received", "salary")).toBe("Salary");
    expect(typeFor("received")).toBe("Income"); expect(typeFor("spent", "Refund")).toBe("Payment");
    expect(draftRows(d({ direction: "received", categoryId: "ref" }), 100, cats)[0]).toMatchObject({ txn_type: "Refund", direction: "credit" });
  });
  it("builds a self transfer as two legs sharing a group and a Y id", () => {
    const [out, into] = draftRows(d({ transfer: true, toAccountId: "cash", name: "" }), 500000, cats);
    expect(out).toMatchObject({ account_id: "bank", direction: "debit", txn_type: "Sent Transfer", amount_minor: 500000, category_id: null });
    expect(into).toMatchObject({ account_id: "cash", direction: "credit", txn_type: "Received Transfer", amount_minor: 500000 });
    expect(out.transfer_group).toBe(into.transfer_group); expect(out.transfer_group).toBeTruthy();
    expect(out.txn_id).toBe(into.txn_id); expect(out.txn_id).toMatch(/^Y/);
    expect(out.client_uid).not.toBe(into.client_uid);
  });
  it("keeps ids when editing", () => {
    const ex = { client_uid: "orig-uid-1", txn_id: "Nzzzzzz" } as Entry;
    expect(draftRows(d({}), 100, cats, ex)[0]).toMatchObject({ client_uid: "orig-uid-1", txn_id: "Nzzzzzz" });
  });
});

describe("amountText", () => {
  it("round-trips through parseAmount for every currency size", () => {
    for (const [m, c] of [[34000, "INR"], [5, "INR"], [500, "JPY"], [1234, "KWD"], [100, "INR"]] as const) expect(parseAmount(amountText(m, c), c)).toBe(m);
    expect(amountText(5, "INR")).toBe("0.05");
  });
  it("restores a stored entry into the form", () => {
    const e = { amount_minor: 12050, direction: "credit", account_id: "bank", category_id: null, expense_name: "Bonus", more_info: null, entry_date: "2026-11-01" } as Entry;
    expect(draftFromEntry(e, "INR")).toMatchObject({ amount: "120.50", direction: "received", name: "Bonus", date: "2026-11-01" });
  });
});
