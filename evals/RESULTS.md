# Quick-log eval results

Run on 2026-11-05 against Cloudflare Workers AI (free allowance), through a temporary,
key-locked Edge Function so the Cloudflare token never left Supabase. Two sets:
`cases.json` (41, written alongside the plain-code rules, so rules score there is
optimistic) and `holdout.json` (40, written later and run once before any fixes).

"Hybrid" is what the app does: the plain-code parser on the phone first; only entries
it isn't sure about go to the AI (6 of 41 and 5 of 40 here).

Targets: amount >= 95%, category >= 85%.

| Model | neurons/read | AI alone, cases: amount / category | AI alone, holdout | Hybrid, holdout |
|---|---|---|---|---|
| @cf/mistralai/mistral-small-3.1-24b-instruct | 28 | 100 / 97.1 | 100 / 88.2 | **100 / 100** |
| @cf/ibm-granite/granite-4.0-h-micro | 2 | 97.6 / 85.7 | 90 / 70.6 | 97.5 / 100 |
| @cf/meta/llama-3.1-8b-instruct-fp8 | 11.5 | 100 / 51.4 | 92.5 / 47.1 | 100 / 94.1 |
| @cf/google/gemma-4-26b-a4b-it | ~13 | 0 (reasoning model, no answer in 300 tokens) | 0 | – |
| @cf/zai-org/glm-4.7-flash | ~14.5 | 0 (reasoning model, no answer in 300 tokens) | 0 | – |
| Plain-code rules only | 0 | 100 / 100 (optimistic) | 97.5 / 97.1 (before fixes) | – |

Chosen: **Mistral Small 3.1** (default in `_shared/parse.ts`, override with the `AI_MODEL`
secret). Only the hard ~1 in 8 entries reach the AI, so its own accuracy matters most; it
is the only model that read "lunch 150 and chai 20" as 170. Free allowance (10,000
neurons/day, shared by all users) covers roughly 350 AI reads a day. Granite is the
fallback if that runs short: 14x cheaper, weaker on its own.

Found and fixed during this run: models refusing JSON-schema mode answer 403 (code 5025),
not 400; newer models reply in the OpenAI `choices[0].message.content` shape.

Not yet measured: month-review output against a real model (it is validated in code and
falls back to the no-AI template), and real users' sentences (see the usage metrics).
