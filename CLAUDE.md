# Spend Roll (pwa-v2)

Read first: `RELEASE.md` (how to ship), `BACKEND-NOTES.md`, `ui-spec.md`, `BACKLOG.md`.

## Environments

| | Dev | Prod |
|---|---|---|
| App name | Spend Roll Dev | Spend Roll |
| Git branch | `claude/clever-heisenberg-dyx38u` | `main` |
| Web URL | `https://claude-clever-heisenberg-dyx38u-pwa-v2.bibhutibhusanpanda2003.workers.dev` | `https://pwa-v2.bibhutibhusanpanda2003.workers.dev` |
| Supabase project | `pwa-v2-dev` (`siarjxgxpbpyxfwrdptn`) | `pwa-v2` (`mxodmmsnyzrdklyzhibt`) |
| `app_config.env` | `dev` | `prod` |

- The dev URL comes from the branch name. Keep working on the dev branch above so the URL never changes. Do not start a new branch for dev work.
- Web app is in `web/` (Vite + React). Server code is in `supabase/` (migrations, edge functions, tests).

## Rules

1. **User data must never be lost.** Anything that touches prod follows `RELEASE.md` in order: checks, fingerprint, backup, migrations, fingerprint again, functions, web merge, smoke test, update `supabase/PROD_AT`.
2. **Never change a database by hand outside a migration file.** Applied migrations are never edited. Record every applied migration in the database's migration list.
3. **Migrations before the web app.** Merge to `main` only after the migrations are on prod.
4. **Resets are dev only.** `scripts/dev-reset.sql` refuses to run unless `app_config.env = 'dev'`. Test account: `testing@spendroll.com`. Never touch `randomfactsdaily910@gmail.com`.
5. **Do not merge to `main` or touch prod unless the owner says "ship it".** Show the exact release list first.
6. Risky statements in a migration (delete, update, drop, rename, cascade) need `-- data-safe: <reason>` after a review, or the `checks` workflow fails.

## Test flow with the owner

Work in phases: sign-in, email code, onboarding, then later screens. When the owner asks for a change in a phase, make it, push to the dev branch, reset only that phase for the test account (`scripts/dev-reset.sql`), and tell them to test again. Earlier phases keep their progress.

## Commands

- Web: `cd web && npm ci && npm test && npm run build` (needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; see `web/.env.example`).
- Database tests (as non-root): `sudo -u postgres scripts/test-db.sh`.
- Data-safety test: `sudo -u postgres scripts/upgrade-test.sh "$(cat supabase/PROD_AT)"`.
- Migration guard: `scripts/migration-guard.sh`.

## Secrets (set in the Supabase dashboard, never in the repo)

- `ALLOWED_ORIGINS` on each project: comma-separated web URLs allowed to call `email-otp`. Add a URL there whenever a new web URL is used.
- Also `OTP_PEPPER`, `SMTP_*`, `APP_NAME` ("Spend Roll Dev" on dev).

## Style

Owner wants short, plain answers. Keep screens light on text, with a clear order of importance (size, weight, placement).
