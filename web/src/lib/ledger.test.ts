import { describe, expect, it } from "vitest";
import { addDays, addMonths, balances, dayState, daysInMonth, loggedDatesOf, missedDays, monthTotals, spendBy, spendByDay, streak } from "./ledger";
import { buildPlan } from "./plan";
import { cell, entriesCsv } from "./csv";
import { reviewFacts } from "./reviewFacts";
import { validateReview, templateReview } from "../../../supabase/functions/_shared/review.ts";
import { currencyDigits } from "./money";
import type { Account, Budget, Category, Entry } from "./types";

const acc = (id: string, currency = "INR"): Account => ({ id, client_uid: id, name: id, currency, sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" });
const cat = (id: string, name: string): Category => ({ id, client_uid: id, name, sort_order: 0, archived_at: null, deleted_at: null, updated_at: "" });
let n = 0;
const e = (o: Partial<Entry>): Entry => ({
  id: "e" + ++n, client_uid: "c" + n, entry_date: "2026-11-02", txn_id: "Nabcdef", account_id: "bank", category_id: null,
  expense_name: "x", more_info: null, txn_type: "Payment", amount_minor: 100, direction: "debit", transfer_group: null,
  created_at: "2026-11-02T00:00:0" + (n % 10), updated_at: "", deleted_at: null, ...o,
});
const accounts = [acc("bank"), acc("cash"), acc("usd", "USD")];

const data: Entry[] = [
  e({ txn_type: "Opening balance", expense_name: "Opening balance", amount_minor: 1000000, direction: "credit", entry_date: "2026-11-01" }),
  e({ amount_minor: 34000, category_id: "food", expense_name: "Swiggy" }),
  e({ amount_minor: 6000, category_id: "food", expense_name: "swiggy ", entry_date: "2026-11-03" }),
  e({ amount_minor: 200000, category_id: "rent", expense_name: "Rent", entry_date: "2026-11-01" }),
  e({ amount_minor: 6500000, direction: "credit", category_id: "sal", expense_name: "Salary", txn_type: "Salary", entry_date: "2026-11-01" }),
  // transfer bank -> cash: moves money, is not spend or income
  e({ amount_minor: 50000, transfer_group: "t1", txn_id: "Ytrans1", txn_type: "Sent Transfer" }),
  e({ amount_minor: 50000, transfer_group: "t1", txn_id: "Ytrans1", txn_type: "Received Transfer", direction: "credit", account_id: "cash" }),
  e({ amount_minor: 99999, deleted_at: "2026-11-03T00:00:00Z" }),                    // deleted: ignored everywhere
  e({ amount_minor: 1200, account_id: "usd", direction: "debit", expense_name: "Uber" }),   // other currency
  e({ amount_minor: 777, entry_date: "2026-10-31" }),                                  // other month
];

describe("balances and totals", () => {
  it("balances count transfers and opening balances, not deleted rows", () => {
    const b = balances(data);
    expect(b.get("bank")).toBe(1000000 + 6500000 - 34000 - 6000 - 200000 - 50000 - 777);
    expect(b.get("cash")).toBe(50000);
    expect(b.get("usd")).toBe(-1200);
    expect(balances(data, "2026-11-01").get("bank")).toBe(1000000 + 6500000 - 200000 - 777);   // stops at the day
  });
  it("month totals skip transfers and opening balances, and never mix currencies", () => {
    const t = monthTotals(data, accounts, "2026-11");
    expect(t.get("INR")).toEqual({ spent: 34000 + 6000 + 200000, income: 6500000, net: 6500000 - 240000 });
    expect(t.get("USD")).toEqual({ spent: 1200, income: 0, net: -1200 });
  });
  it("groups spend by category, name and day", () => {
    expect(spendBy(data, accounts, "2026-11", "INR", (x) => x.category_id ?? "").map((s) => [s.key, s.spent])).toEqual([["rent", 200000], ["food", 40000]]);
    expect(spendBy(data, accounts, "2026-11", "INR", (x) => x.expense_name.trim().toLowerCase())[1]).toEqual({ key: "swiggy", spent: 40000 });
    const days = spendByDay(data, accounts, "2026-11", "INR");
    expect(days).toHaveLength(30);
    expect([days[0], days[1], days[2]]).toEqual([200000, 34000, 6000]);
  });
  it("does the calendar maths", () => {
    expect(daysInMonth("2026-02")).toBe(28); expect(daysInMonth("2028-02")).toBe(29);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01"); expect(addMonths("2026-11", 2)).toBe("2027-01"); expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("day status and streak", () => {
  const logged = loggedDatesOf(data);               // Nov 1, 2, 3 (opening balance alone doesn't count)
  const noSpend = new Set(["2026-10-30"]);
  const st = (d: string) => dayState(d, logged, noSpend);

  it("an opening balance alone never marks a day logged", () => {
    expect(loggedDatesOf([data[0]]).size).toBe(0);
  });
  it("derives logged / no_spend / open", () => {
    expect([st("2026-11-02"), st("2026-10-30"), st("2026-10-29")]).toEqual(["logged", "no_spend", "open"]);
  });
  it("counts consecutive logged or no-spend days", () => {
    // Nov 3, 2, 1 and Oct 31 are logged, Oct 30 is no-spend, Oct 29 is open: 5 days.
    expect(streak("2026-11-03", st, "2026-10-01")).toBe(5);
  });
  it("today being open doesn't break the streak yet", () => {
    expect(streak("2026-11-04", st, "2026-10-01")).toBe(streak("2026-11-03", st, "2026-10-01"));
  });
  it("a missed day breaks it, and never counts before your first day", () => {
    expect(streak("2026-11-06", st, "2026-10-01")).toBe(0);
    expect(streak("2026-11-03", st, "2026-11-02")).toBe(2);
  });
  it("lists missed days newest first, never before the first day, never today", () => {
    expect(missedDays("2026-11-06", st, "2026-10-01").slice(0, 3)).toEqual(["2026-11-05", "2026-11-04", "2026-10-29"].slice(0, 3));
    expect(missedDays("2026-11-06", st, "2026-11-05")).toEqual(["2026-11-05"]);
    expect(missedDays("2026-11-03", st, "2026-11-03")).toEqual([]);
  });
});

describe("plan", () => {
  const budgets: Budget[] = [
    { id: "1", month: "2026-11-01", category_id: "food", amount_minor: 30000 },
    { id: "2", month: "2026-11-01", category_id: "rent", amount_minor: 250000 },
    { id: "3", month: "2026-11-01", category_id: null, amount_minor: 1000000 },
    { id: "4", month: "2026-10-01", category_id: "food", amount_minor: 1 },
  ];
  it("shows spent, left, over, and a safe daily spend from integers", () => {
    const p = buildPlan(data, accounts, budgets, "2026-11", "2026-11-03", "INR");
    expect(p.budgetTotal).toBe(280000);
    expect(p.spentTotal).toBe(240000);
    expect(p.rows.find((r) => r.category_id === "food")).toMatchObject({ spent: 40000, left: -10000, over: true });
    expect(p.left).toBe(40000);
    expect(p.daysLeft).toBe(28);                       // Nov 3..30
    expect(p.safeDaily).toBe(Math.floor(40000 / 28));
    expect(p.savingsTarget).toBe(1000000);
    expect(p.saved).toBe(6500000 - 240000);
    expect(p.leftToSave).toBe(0);
  });
  it("safe daily is 0 when you are over, and the last day counts", () => {
    const over = buildPlan(data, accounts, [{ id: "1", month: "2026-11-01", category_id: "rent", amount_minor: 100 }], "2026-11", "2026-11-30", "INR");
    expect(over.left).toBeLessThan(0); expect(over.safeDaily).toBe(0); expect(over.daysLeft).toBe(1);
  });
  it("a month already over has no days left", () => {
    expect(buildPlan(data, accounts, budgets, "2026-10", "2026-11-03", "INR").daysLeft).toBe(0);
  });
});

describe("csv", () => {
  it("writes amounts from integers and defuses formulas", () => {
    const csv = entriesCsv(data, accounts, [cat("food", "Food & dining")], currencyDigits);
    expect(csv.split("\r\n")[0]).toBe("date,account,currency,name,category,direction,amount,note,type,transfer,id");
    expect(csv).toContain("2026-11-02,bank,INR,Swiggy,Food & dining,out,340.00,,Payment,");
    expect(csv).not.toContain("999.99");                           // deleted row
    expect(cell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(cell('a,"b"')).toBe('"a,""b"""');
    expect(cell("-5 off")).toBe("'-5 off");
  });
});

describe("review facts", () => {
  it("are formatted by code, and a reply that changes a number is refused", () => {
    const budgets: Budget[] = [{ id: "1", month: "2026-11-01", category_id: "food", amount_minor: 30000 }];
    const f = reviewFacts(data, accounts, [cat("food", "Food"), cat("rent", "Rent")], budgets, new Set(["2026-11-05"]), "2026-11", "2026-11-30", "INR");
    expect(f.spent).toBe("₹2,400.00");
    expect(f.categories.find((c) => c.name === "Food")).toMatchObject({ spent: "₹400.00", budget: "₹300.00", over_by: "₹100.00" });
    expect(f.top_places[0].name).toBe("rent");
    expect(f.no_spend_days).toBe(1);
    expect(validateReview(templateReview(f), f)).not.toBeNull();
    expect(validateReview({ summary: "You spent ₹2,401.00", suggestions: ["a", "b", "c"] }, f)).toBeNull();
  });
});
