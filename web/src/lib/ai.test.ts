import { describe, expect, it } from "vitest";
import { failMessage, proposalToDraft } from "./ai";
import type { Proposal } from "../../../supabase/functions/_shared/parse.ts";
import type { Account, Category } from "./types";

const acc = (id: string, name: string, currency = "INR"): Account => ({ id, client_uid: id, name, currency, sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" });
const accounts = [acc("u", "UPI bank"), acc("c", "Cash"), acc("us", "US account", "USD")];
const cats: Category[] = [{ id: "f", client_uid: "f", name: "Food & dining", sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" }];
const p = (o: Partial<Proposal>): Proposal => ({ amount_minor: 34000, currency: null, account: "UPI bank", transfer_to: null, category: "Food & dining", name: "Swiggy", direction: "spent", date: "2026-11-03", note: null, confidence: 0.9, ...o });

describe("proposalToDraft", () => {
  it("fills the form from a clean proposal", () => {
    const r = proposalToDraft(p({}), accounts, cats, null, "2026-11-03");
    expect(r.draft).toMatchObject({ accountId: "u", amount: "340.00", categoryId: "f", name: "Swiggy", direction: "spent", transfer: false });
    expect(r.assumedAccount).toBe(false); expect(r.hint).toBeUndefined();
  });
  it("uses your last account when the text named none, and says so", () => {
    const r = proposalToDraft(p({ account: null }), accounts, cats, "c", "2026-11-03");
    expect(r.draft.accountId).toBe("c"); expect(r.assumedAccount).toBe(true);
  });
  it("leaves the account empty rather than guessing between several", () => {
    expect(proposalToDraft(p({ account: null }), accounts, cats, null, "2026-11-03").draft.accountId).toBe("");
  });
  it("moves a USD amount to a USD account, or asks for one", () => {
    expect(proposalToDraft(p({ currency: "USD", amount_minor: 1200, account: null }), accounts, cats, "u", "2026-11-03").draft)
      .toMatchObject({ accountId: "us", amount: "12.00" });
    const r = proposalToDraft(p({ currency: "EUR", amount_minor: 500 }), accounts, cats, null, "2026-11-03");
    expect(r.draft.accountId).toBe(""); expect(r.hint).toContain("EUR");
  });
  it("builds a transfer when both accounts are yours", () => {
    expect(proposalToDraft(p({ transfer_to: "Cash", amount_minor: 500000, name: "Self transfer" }), accounts, cats, null, "2026-11-03").draft)
      .toMatchObject({ transfer: true, accountId: "u", toAccountId: "c", amount: "5000.00" });
  });
  it("leaves the amount empty when none was found, and warns on low confidence", () => {
    const r = proposalToDraft(p({ amount_minor: null, confidence: 0.2 }), accounts, cats, null, "2026-11-03");
    expect(r.draft.amount).toBe(""); expect(r.hint).toContain("Not sure");
  });
  it("always has a manual way out in its failure messages", () => {
    for (const reason of ["daily_cap", "minute_cap", "unavailable"] as const) expect(failMessage({ reason })).toMatch(/by hand/);
  });
});
