# Release: dev to prod

Goal: no user data is ever lost. Each step has a check, and any failed check stops the release.

Prod Supabase project: `pwa-v2` (`mxodmmsnyzrdklyzhibt`), `app_config.env = 'prod'`.
Dev Supabase project: `pwa-v2-dev` (`siarjxgxpbpyxfwrdptn`), `app_config.env = 'dev'`.

## Before (no prod changes)

1. **Checks green.** The `checks` workflow passes on the branch. It runs:
   - `scripts/migration-guard.sh`: any delete, update, drop, rename or type change in a new migration needs a `-- data-safe: <reason>` note.
   - `scripts/upgrade-test.sh $(cat supabase/PROD_AT)`: builds prod's schema, loads real-shaped data, applies the new migrations. It fails if any table loses rows or columns. `CHANGED` means rows were edited, and someone must read why before release.
2. **No drift.** Prod's applied migration list must equal `supabase/PROD_AT` and everything before it. If prod has anything the repo doesn't, stop and find out why.
3. **Owner says "ship it"** after testing on dev.

## Release (in this order)

4. **Fingerprint prod.** Run `scripts/fingerprint.sql` and save the output in the release notes.
5. **Back up prod.** Run `scripts/backup.sql`. Every row must show `copied = live`.
6. **Migrations.** Apply each new migration to prod, one at a time, oldest first.
7. **Fingerprint again.** No table may have fewer rows or columns than in step 4. If one does, restore it from the backup (see below) and stop.
8. **Server functions.** Redeploy only the functions that changed.
9. **Web app.** Merge into `main`. Cloudflare deploys prod by itself. Migrations go first, so the new app never runs against an old database.
10. **Smoke test.** On prod: sign in, the dashboard shows the same totals as before, add one entry, then delete it.
11. **Record.** Update `supabase/PROD_AT` to the newest migration now on prod.

## Rollback

- **Web app:** redeploy the previous build from Cloudflare or revert the merge. Data is not touched.
- **Lost or broken rows:** `insert into public.<table> select * from backup_<time>.public__<table> on conflict do nothing;`
- **Bad migration:** write a new migration that undoes it. Never edit one that is already applied.

## Never

- Run `scripts/dev-reset.sql` on prod. It refuses anyway, because prod's `env` is `prod`.
- Change prod's database by hand outside a migration file. That is how prod ended up with 0021 applied but not recorded.
- Merge to `main` before the migrations are on prod.

## Known limits

- Backups live inside the same database. They protect against a bad release, not against losing the whole project. Supabase Pro adds daily backups (7 days kept).
- The phone keeps only a read copy of the data. Every save goes straight to the server, so nothing waits unsent on the phone.
