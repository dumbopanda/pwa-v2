import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount, currencyDigits } from "./money";
import { newTxnId, todayLocal } from "./ids";
import { openingBalanceRows, validateAccounts, type AccountDraft } from "./onboarding";

describe("parseAmount", () => {
  it.each([
    ["340", 34000], ["1,200.50", 120050], ["₹ 340", 34000], ["Rs.99", 9900], ["0.5", 50],
    ["007", 700], ["99,99,999.99", 999999999], ["12.", 1200],
  ])("%s -> %i paise", (s, want) => expect(parseAmount(s, "INR")).toBe(want));

  it.each(["", "abc", "0", "-5", "1.234", "1.2.3", "1,00,00,000", "1e5", "12 ab"])(
    "refuses %j", (s) => expect(parseAmount(s, "INR")).toBeNull());

  it("uses each currency's own decimals", () => {
    expect(currencyDigits("JPY")).toBe(0);
    expect(parseAmount("500", "JPY")).toBe(500);
    expect(parseAmount("5.5", "JPY")).toBeNull();
    expect(parseAmount("1.234", "KWD")).toBe(1234);
  });
});

describe("formatMoney", () => {
  it("formats en-IN without floats", () => {
    expect(formatMoney(12345678, "INR")).toBe("₹1,23,456.78");
    expect(formatMoney(5, "INR")).toBe("₹0.05");
    expect(formatMoney(-34000, "INR")).toBe("−₹340.00");
    expect(formatMoney(500, "JPY")).toBe("JP¥500");
    expect(formatMoney(999999999, "INR")).toBe("₹99,99,999.99");
  });
  it("round-trips through parseAmount", () => {
    for (const m of [1, 99, 100, 120050, 999999999]) {
      expect(parseAmount(formatMoney(m, "INR").replace("₹", ""), "INR")).toBe(m);
    }
  });
});

describe("ids", () => {
  it("makes txn ids in the database format", () => {
    for (let i = 0; i < 200; i++) expect(newTxnId("N")).toMatch(/^N[a-z0-9]{6}$/);
    expect(newTxnId("Y")).toMatch(/^Y[a-z0-9]{6}$/);
  });
  it("uses the local calendar date", () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("onboarding", () => {
  const d = (over: Partial<AccountDraft>): AccountDraft => ({
    uid: "u-" + Math.random(), balanceUid: "b-" + Math.random(), name: "Cash",
    currency: "INR", balance: "", owe: false, ...over,
  });

  it("validates names and balances", () => {
    const r = validateAccounts([d({ name: "Cash" }), d({ name: " cash " }), d({ name: "" }), d({ name: "Card", balance: "x" })]);
    expect(r.rows).toEqual([null, "Two accounts can't share a name", "Give it a name", "That balance doesn't look like an amount"]);
    expect(validateAccounts([]).form).toBe("Add at least one account");
  });

  it("builds opening balance rows: credit if you have it, debit if you owe it, none for zero", () => {
    const a = d({ uid: "a", name: "Bank", balance: "12,500" });
    const b = d({ uid: "b", name: "Card", balance: "3000", owe: true });
    const c = d({ uid: "c", name: "Cash", balance: "" });
    const rows = openingBalanceRows([a, b, c], new Map([["a", "id-a"], ["b", "id-b"], ["c", "id-c"]]), "2026-11-03");
    expect(rows.map((r) => [r.account_id, r.amount_minor, r.direction])).toEqual([
      ["id-a", 1250000, "credit"], ["id-b", 300000, "debit"],
    ]);
    expect(rows[0]).toMatchObject({ expense_name: "Opening balance", txn_type: "Opening balance", entry_date: "2026-11-03", category_id: null });
  });
});
