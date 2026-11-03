import { describe, expect, it } from "vitest";
import { normalizeProposal, redactSms, buildUserMessage, weekday, extractToolInput, type ParseInput } from "../../../supabase/functions/_shared/parse.ts";
import { templateReview, validateReview, type ReviewFacts } from "../../../supabase/functions/_shared/review.ts";
import { scoreCase, summarize, type Case } from "../../../evals/score.ts";
import cases from "../../../evals/cases.json";

const input: ParseInput = { text: "x", accounts: ["UPI bank", "Cash"], categories: ["Food & dining", "Transport"], today: "2026-11-03" };
const raw = (o: object) => ({ amount: "340", currency: null, account: "UPI bank", transfer_to: null, category: "Food & dining",
  name: "swiggy", direction: "spent", date: null, note: null, confidence: 0.9, ...o });

describe("normalizeProposal", () => {
  it("turns a clean reply into integer minor units", () => {
    expect(normalizeProposal(raw({}), input)).toMatchObject({ amount_minor: 34000, account: "UPI bank", category: "Food & dining", date: "2026-11-03", direction: "spent" });
  });
  it("matches names case-insensitively but never invents one", () => {
    expect(normalizeProposal(raw({ account: " upi BANK ", category: "Pets" }), input)).toMatchObject({ account: "UPI bank", category: null });
    expect(normalizeProposal(raw({ account: "Savings" }), input)?.account).toBeNull();
  });
  it("refuses bad amounts rather than guessing", () => {
    for (const a of [null, "", "abc", "-5", "0", "1.234", "99999999999", "1e3"]) expect(normalizeProposal(raw({ amount: a }), input)?.amount_minor).toBeNull();
  });
  it("caps confidence when the amount is missing", () => {
    expect(normalizeProposal(raw({ amount: null, confidence: 0.95 }), input)?.confidence).toBeLessThanOrEqual(0.3);
  });
  it("never accepts a future or malformed date", () => {
    expect(normalizeProposal(raw({ date: "2026-12-01" }), input)?.date).toBe("2026-11-03");
    expect(normalizeProposal(raw({ date: "yesterday" }), input)?.date).toBe("2026-11-03");
    expect(normalizeProposal(raw({ date: "2026-11-02" }), input)?.date).toBe("2026-11-02");
  });
  it("accepts a transfer only between two different known accounts", () => {
    expect(normalizeProposal(raw({ account: "UPI bank", transfer_to: "Cash", category: "Transport" }), input))
      .toMatchObject({ transfer_to: "Cash", name: "Self transfer", category: null });
    expect(normalizeProposal(raw({ account: "Cash", transfer_to: "Cash" }), input)?.transfer_to).toBeNull();
    expect(normalizeProposal(raw({ account: null, transfer_to: "Cash" }), input)?.transfer_to).toBeNull();
  });
  it("uses the stated currency's decimals", () => {
    expect(normalizeProposal(raw({ amount: "500", currency: "jpy" }), input)).toMatchObject({ amount_minor: 500, currency: "JPY" });
    expect(normalizeProposal(raw({ currency: "ZZZZ" }), input)?.currency).toBeNull();
  });
  it("rejects replies with no usable direction", () => {
    expect(normalizeProposal(raw({ direction: "maybe" }), input)).toBeNull();
    expect(normalizeProposal(null, input)).toBeNull();
  });
  it("finds the tool call in an API body", () => {
    expect(extractToolInput({ content: [{ type: "text" }, { type: "tool_use", name: "propose_entry", input: { a: 1 } }] })).toEqual({ a: 1 });
    expect(extractToolInput({ content: [] })).toBeNull();
  });
});

describe("what is sent to the model", () => {
  it("is only the text, the user's own names and today's date", () => {
    const m = buildUserMessage({ ...input, text: "swiggy 340 upi" });
    expect(m).toContain("Tuesday");
    expect(m).toContain("swiggy 340 upi");
    expect(m).toContain('["UPI bank","Cash"]');
  });
  it("cuts balances and account numbers out of a pasted SMS", () => {
    const sms = "Rs.1,250.00 debited from A/c XX1234 on 02-11-26 to zomato@upi. Avl bal Rs 45,300.50 Ref 99";
    const out = redactSms(sms);
    expect(out).not.toMatch(/45,300|1234/);
    expect(out).toContain("1,250.00");
    expect(redactSms("Available balance: INR 70,412.10")).not.toMatch(/70,412/);
    expect(redactSms("swiggy 340 upi")).toBe("swiggy 340 upi");
  });
  it("knows the weekday", () => expect(weekday("2026-11-03")).toBe("Tuesday"));
});

describe("month review", () => {
  const facts: ReviewFacts = {
    month: "November 2026", currency: "INR", spent: "₹38,200.00", income: "₹60,000.00", net: "₹21,800.00",
    savings_target: "₹10,000.00", left_to_save: "₹4,000.00", days_logged: 25, days_in_month: 30, no_spend_days: 3,
    categories: [{ name: "Food & dining", spent: "₹9,000.00", budget: "₹8,000.00", over_by: "₹1,000.00" }],
    top_places: [{ name: "Swiggy", spent: "₹3,400.00" }],
  };
  const ok = { summary: "You spent ₹38,200.00 and logged 25 of 30 days.", suggestions: ["Watch Food & dining.", "Set aside ₹4,000.00 early.", "Keep logging."] };

  it("accepts text that only repeats the given numbers", () => expect(validateReview(ok, facts)).not.toBeNull());
  it("refuses any number that wasn't in the facts", () => {
    expect(validateReview({ ...ok, summary: "You spent ₹38,500.00." }, facts)).toBeNull();
    expect(validateReview({ ...ok, suggestions: ["Cut 20% next month.", "b", "c"] }, facts)).toBeNull();
    expect(validateReview({ ...ok, summary: "You saved ₹21,801.00" }, facts)).toBeNull();
  });
  it("needs exactly three suggestions", () => {
    expect(validateReview({ ...ok, suggestions: ["a", "b"] }, facts)).toBeNull();
    expect(validateReview({ summary: "", suggestions: ["a", "b", "c"] }, facts)).toBeNull();
  });
  it("falls back to a template that passes its own check", () => {
    const t = templateReview(facts);
    expect(t.suggestions).toHaveLength(3);
    expect(validateReview(t, facts)).not.toBeNull();
  });
});

describe("eval scoring", () => {
  const cs = (cases as unknown as { cases: Case[] }).cases;
  it("has the volume and spread the brief asks for", () => {
    expect(cs.length).toBeGreaterThanOrEqual(30);
    for (const tag of ["english", "hinglish", "vague", "currency", "date", "transfer", "refund", "sms"]) expect(cs.some((c) => c.tag === tag)).toBe(true);
  });
  it("scores a perfect answer 100% and a missing one 0%", () => {
    const c = cs[0];
    const p = normalizeProposal({ amount: (c.expect.amount_minor! / 100).toFixed(2), currency: null, account: c.expect.account ?? null, transfer_to: null,
      category: c.expect.category ?? null, name: "x", direction: c.expect.direction, date: c.expect.date, note: null, confidence: 0.9 },
      { text: c.text, accounts: ["UPI bank", "Cash", "Credit card", "Salary account", "US account"], categories: ["Food & dining"], today: "2026-11-03" });
    const good = scoreCase(c, p);
    expect(good.amount && good.direction && good.category && good.account && good.date).toBe(true);
    const none = summarize([scoreCase(c, null)]);
    expect(none.amount_pct).toBe(0);
  });
});
