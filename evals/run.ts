// Runs the quick-log eval set against the real model.
//   ANTHROPIC_API_KEY=... node evals/run.ts          (Node 22.18+)
//   node evals/run.ts --dry                          (no key: proves the scoring works)
// The key is read from the environment only and is never written anywhere.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildRequest, extractToolInput, normalizeProposal, PROPOSE_TOOL, type ParseInput, type Proposal } from "../supabase/functions/_shared/parse.ts";
import { scoreCase, summarize, TARGETS, type Case } from "./score.ts";

const { context, cases }: { context: Omit<ParseInput, "text">; cases: Case[] } =
  JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const dry = process.argv.includes("--dry");
const key = process.env.ANTHROPIC_API_KEY;
if (!dry && !key) { console.error("Set ANTHROPIC_API_KEY, or use --dry."); process.exit(2); }

/** --dry: answer with exactly what each case expects, to prove scoring and normalisation agree. */
function perfect(c: Case): unknown {
  const e = c.expect;
  return {
    amount: e.amount_minor === null ? null : (e.amount_minor / (e.currency === "JPY" ? 1 : 100)).toFixed(e.currency === "JPY" ? 0 : 2),
    currency: e.currency ?? null, account: e.account ?? null, transfer_to: e.transfer_to ?? null,
    category: e.category ?? null, name: "x", direction: e.direction, date: e.date, note: null, confidence: 0.9,
  };
}

async function ask(c: Case): Promise<Proposal | null> {
  const input: ParseInput = { ...context, text: c.text };
  if (dry) return normalizeProposal(perfect(c), input);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(buildRequest(input)),
    });
    if (r.ok) return normalizeProposal(extractToolInput(await r.json(), PROPOSE_TOOL.name), input);
    if (r.status !== 429 && r.status < 500) { console.error(`HTTP ${r.status} for "${c.text}"`); return null; }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
  }
  return null;
}

const results = [];
for (let i = 0; i < cases.length; i += 4) {
  results.push(...await Promise.all(cases.slice(i, i + 4).map(async (c) => scoreCase(c, await ask(c)))));
}

const s = summarize(results);
console.log(JSON.stringify(s, null, 1));
for (const r of results) {
  const wrong = (["amount", "direction", "date", "category", "account", "currency", "transfer"] as const).filter((k) => r[k] === false);
  if (wrong.length) console.log(`  ✗ [${r.tag}] ${r.text.slice(0, 70)}  -> ${wrong.join(", ")}`);
}
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/latest.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), dry, summary: s, results }, null, 1));

const pass = s.amount_pct >= TARGETS.amount_pct && s.category_pct >= TARGETS.category_pct;
console.log(pass ? `PASS (amount >= ${TARGETS.amount_pct}%, category >= ${TARGETS.category_pct}%)` : `BELOW TARGET (amount >= ${TARGETS.amount_pct}%, category >= ${TARGETS.category_pct}%)`);
process.exit(pass ? 0 : 1);
