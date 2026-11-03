// Month-end review. Plain code computes every number and formats every
// amount; the model only writes words around them. validateReview() refuses
// any reply containing a number that isn't in the facts it was given, and the
// app falls back to templateReview() (no AI) in that case.
import { PARSE_MODEL } from "./parse.ts";

export type ReviewFacts = {
  month: string;                         // "November 2026"
  currency: string;
  spent: string; income: string; net: string;            // pre-formatted money
  savings_target: string | null; left_to_save: string | null;
  days_logged: number; days_in_month: number; no_spend_days: number;
  categories: { name: string; spent: string; budget: string | null; over_by: string | null }[];
  top_places: { name: string; spent: string }[];
};

export type ReviewText = { summary: string; suggestions: string[] };

export const REVIEW_TOOL = {
  name: "write_review",
  description: "Write the month-end summary and three suggestions.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "2-4 plain sentences on where the money went." },
      suggestions: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3, description: "Exactly 3 short, practical suggestions for next month." },
    },
    required: ["summary", "suggestions"],
  },
} as const;

export const REVIEW_PROMPT = `You write a calm, plain-language month-end review of a person's spending from numbers that were already computed. Call write_review once.

Hard rules:
- Use ONLY the numbers and amounts exactly as written in the facts. Copy amounts as given, including the currency symbol. Never add, subtract, round, convert, total, average or estimate anything.
- Do not write any number that is not in the facts. Write "a few" or "most" instead of inventing a count. No percentages unless given.
- Never scold. No blame, no shame words. Be encouraging and specific.
- Mention categories that went over budget by name when over_by is set. Mention what is left to save if given.
- Exactly 3 suggestions, each one short sentence, each about next month and tied to the facts.`;

export function buildReviewRequest(f: ReviewFacts) {
  return {
    model: PARSE_MODEL,
    max_tokens: 700,
    temperature: 0.3,
    system: REVIEW_PROMPT,
    tools: [REVIEW_TOOL],
    tool_choice: { type: "tool", name: REVIEW_TOOL.name },
    messages: [{ role: "user", content: `Facts:\n${JSON.stringify(f)}` }],
  };
}

const NUM = /\d[\d,]*(?:\.\d+)?/g;
const canon = (s: string) => s.replace(/,/g, "");
const numbersIn = (s: string) => (s.match(NUM) ?? []).map(canon);

/** Text is acceptable only if every number in it appears in the facts. */
export function validateReview(raw: unknown, facts: ReviewFacts): ReviewText | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { summary?: unknown; suggestions?: unknown };
  if (typeof r.summary !== "string" || !r.summary.trim()) return null;
  if (!Array.isArray(r.suggestions) || r.suggestions.length !== 3 || !r.suggestions.every((s) => typeof s === "string" && s.trim())) return null;

  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  const text = [r.summary, ...(r.suggestions as string[])];
  if (text.some((t) => t.length > 600)) return null;
  for (const t of text) for (const n of numbersIn(t)) if (!allowed.has(n)) return null;
  return { summary: r.summary.trim(), suggestions: (r.suggestions as string[]).map((s) => s.trim()) };
}

/** No-AI fallback: the same facts in plain sentences. */
export function templateReview(f: ReviewFacts): ReviewText {
  const over = f.categories.filter((c) => c.over_by);
  const parts = [`In ${f.month} you spent ${f.spent} and received ${f.income}, so the month ended at ${f.net}.`];
  if (f.savings_target && f.left_to_save) parts.push(`Your savings target was ${f.savings_target}; ${f.left_to_save} is still left to set aside.`);
  parts.push(`You logged ${f.days_logged} of ${f.days_in_month} days.`);
  const suggestions = [
    over.length ? `Look at ${over.map((c) => c.name).join(", ")}, which went over plan, and adjust next month's budget or spending there.`
                : "Your categories stayed within plan. Keep the same budgets next month.",
    f.top_places[0] ? `${f.top_places[0].name} took the most (${f.top_places[0].spent}). Decide if that is where you want it to go.` : "Log a few more days to see where your money goes.",
    f.savings_target ? "Move your savings target on payday so it is not left to the end of the month." : "Set a savings target for next month in Plan.",
  ];
  return { summary: parts.join(" "), suggestions };
}
