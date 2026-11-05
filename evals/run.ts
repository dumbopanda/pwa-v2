// Quick-log evals. Node 22.18+ runs this TypeScript directly.
//   node evals/run.ts --rules [--holdout]          plain-code parser only (free, no key)
//   CF_ACCOUNT_ID=.. CF_API_TOKEN=.. [AI_MODEL=@cf/..] node evals/run.ts --ai [--holdout]
//   CF_ACCOUNT_ID=.. CF_API_TOKEN=.. node evals/run.ts [--holdout]      hybrid: rules, then AI when unsure (what the app does)
//   node evals/run.ts --dry                         proves the scoring code only
// Credentials are read from the environment only and are never written anywhere.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildMessages, DEFAULT_MODEL, extractJson, normalizeProposal, PROPOSAL_SCHEMA, type ParseInput, type Proposal } from "../supabase/functions/_shared/parse.ts";
import { parseRules } from "../supabase/functions/_shared/rules.ts";
import { scoreCase, summarize, TARGETS, type Case } from "./score.ts";

const arg = (f: string) => process.argv.includes(f);
const file = arg("--holdout") ? "./holdout.json" : "./cases.json";
const { context, cases }: { context: Omit<ParseInput, "text">; cases: Case[] } = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const mode = arg("--dry") ? "dry" : arg("--rules") ? "rules" : arg("--ai") ? "ai" : "hybrid";
const account = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN, model = process.env.AI_MODEL || DEFAULT_MODEL;
if ((mode === "ai" || mode === "hybrid") && (!account || !token)) { console.error("Set CF_ACCOUNT_ID and CF_API_TOKEN, or use --rules / --dry."); process.exit(2); }

function perfect(c: Case): unknown {
  const e = c.expect;
  return { amount: e.amount_minor === null ? null : (e.amount_minor / 100).toFixed(2), currency: e.currency ?? null, account: e.account ?? null,
    transfer_to: e.transfer_to ?? null, category: e.category ?? null, name: "x", direction: e.direction, date: e.date, note: null, confidence: 0.9 };
}

async function ai(input: ParseInput): Promise<Proposal | null> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
  const send = (json: boolean) => fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: buildMessages(input), max_tokens: 300, temperature: 0, ...(json ? { response_format: { type: "json_schema", json_schema: PROPOSAL_SCHEMA } } : {}) }) });
  for (let attempt = 0; attempt < 3; attempt++) {
    let r = await send(true);
    if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) r = await send(false);
    if (r.ok) return normalizeProposal(extractJson(await r.json()), input);
    if (r.status !== 429 && r.status < 500) { console.error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); return null; }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
  }
  return null;
}

let sentToAi = 0;
async function ask(c: Case): Promise<Proposal | null> {
  const input: ParseInput = { ...context, text: c.text };
  if (mode === "dry") return normalizeProposal(perfect(c), input);
  if (mode === "ai") return ai(input);
  const r = parseRules(input);
  if (mode === "rules" || r.sure) return r;
  sentToAi++;
  return (await ai(input)) ?? r;
}

const results = [];
for (let i = 0; i < cases.length; i += 4) results.push(...await Promise.all(cases.slice(i, i + 4).map(async (c) => scoreCase(c, await ask(c)))));

const s = summarize(results);
console.log(`${mode}${mode !== "rules" && mode !== "dry" ? ` (${model})` : ""} on ${file.slice(2)}`);
console.log(JSON.stringify(s, null, 1));
if (mode === "hybrid") console.log(`sent to AI: ${sentToAi} of ${cases.length}`);
for (const r of results) {
  const wrong = (["amount", "direction", "date", "category", "account", "currency", "transfer"] as const).filter((k) => r[k] === false);
  if (wrong.length) console.log(`  ✗ [${r.tag}] ${r.text.slice(0, 70)}  -> ${wrong.join(", ")}`);
}
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/${mode}-${file.slice(2)}`, import.meta.url), JSON.stringify({ at: new Date().toISOString(), mode, model, summary: s, results }, null, 1));
const pass = s.amount_pct >= TARGETS.amount_pct && s.category_pct >= TARGETS.category_pct;
console.log(pass ? `PASS (amount >= ${TARGETS.amount_pct}%, category >= ${TARGETS.category_pct}%)` : `BELOW TARGET (amount >= ${TARGETS.amount_pct}%, category >= ${TARGETS.category_pct}%)`);
process.exit(pass ? 0 : 1);
