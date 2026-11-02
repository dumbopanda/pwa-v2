# Backend notes

Postgres 17 on Supabase, from migrations 0001 to 0013.

## Tables (schema `public`)

**profiles**: `user_id` uuid PK, FK auth.users, cascade. `display_name` text (<=80). `plan` text default 'free' (free/supporter). `entitlement_expires_at` timestamptz. `country` char(2). `currency` char(3) default 'INR'. `entry_count` int default 0. `onboarded_at`, `consent_version` int, `consent_at`. `created_at`, `updated_at`. `age` smallint (13 to 120). `location` text (<=80). `occupation` text, one of 15 fixed labels.

**app_config**: `key` text PK, `value` jsonb. Seeds: `max_entries_per_user` 100000, `sync_page_size` 500, `min_supported_build` 1.

**accounts**: `id` uuid PK default gen_random_uuid(). `user_id` uuid default auth.uid(), FK cascade. `client_uid` text (8 to 64). `name` text (trimmed 1 to 40). `sort_order` int. `archived_at`, `created_at`, `updated_at`, `deleted_at`. Unique (user_id, client_uid) and (id, user_id). Unique live name per user, case-insensitive.

**entries**: `id` uuid PK. `user_id` as above. `client_uid` text (8 to 64). `entry_date` date (>= 2000-01-01). `txn_id` text, `^[YN][a-z0-9]{6}$`. `account_id` uuid, composite FK (account_id, user_id) to accounts. `expense_name` text (1 to 120). `more_info` text (<=300). `txn_type` text (1 to 60). `txn_freq` enum one_off/monthly, default monthly. `amount_minor` bigint, > 0 and <= 999999999. `direction` enum debit/credit. `transfer_group` uuid. `created_at`, `updated_at`, `deleted_at`. Unique (user_id, client_uid).

**email_otps**: `id` bigint identity PK, `email` (lowercase), `code_hash`, `ip`, `created_at`, `expires_at`, `attempts` smallint, `consumed_at`, `invalidated_at`.

## IDs
- Row `id`: server uuid. `client_uid`: client-made UUID string, the sync idempotency key.
- `txn_id`: `Y` or `N` plus 6 random a-z0-9 chars, client-generated, not unique. `Y` means "will I get this back". One loan or one transfer shares one `txn_id`.

## Money, time, deletes, sync
- Money: integer paise in `amount_minor`, always positive; `direction` gives the sign. Max 99,99,999.99. INR only.
- A trigger sets `created_at` (immutable) and `updated_at` on every write. Clients cannot.
- No DELETE policy. Deleting sets `deleted_at` (tombstone). Deleting one transfer leg tombstones its sibling by trigger.
- `push_entries(jsonb)` upserts on (user_id, client_uid) in one transaction, with `deleted_at = coalesce(existing, incoming)`, so a push never undoes a delete. Accounts use a PostgREST upsert on the same key.
- `pull_entries` / `pull_accounts` (since, since_id, limit): rows with (updated_at, id) after the cursor, ordered by both, limit clamped 1 to 1000, tombstones included.
- A statement trigger enforces `max_entries_per_user` (error P0002) through `profiles.entry_count`.

## Row shapes
- **Loan**: lending is one row, `txn_id` `Y`+6, normally debit, `transfer_group` null. Repayment is a second row with the same `txn_id`, normally credit. Odd live-row count means open, even means settled (`open_y_ids()`). Loans are left out of spend totals.
- **Self transfer**: two rows share one `transfer_group` and one `Y` `txn_id`. Sent: From account, debit, `txn_type` "Sent Transfer". Received: To account, credit, "Received Transfer". Both: `expense_name` "Self Transfer", same amount and date. A deferred trigger demands exactly two live legs, one debit, one credit, equal amount and date.
- **Opening balance**: one ordinary row per account. `expense_name` and `txn_type` both "Opening balance", `txn_id` `N`+6, `transfer_group` null. Credit if positive, debit if negative (a card). Dated on the account's earliest real entry, else today. Zero tombstones it. One per account is an app rule, not a constraint. Counts toward balance, hidden from History, not spend or income.

## RLS
profiles, accounts and entries use ENABLE and FORCE.
- **profiles**: select and update for `authenticated` where `user_id = (select auth.uid())`. No insert policy (the signup trigger inserts). A trigger resets `plan`, `entitlement_expires_at` and `entry_count` on client updates.
- **app_config**: select for all, no writes.
- **accounts**, **entries**: select, insert, update for `authenticated` on the same test. No delete.
- **email_otps**: RLS on, no policies, privileges revoked. Only `service_role`, via `otp_issue`, `otp_check`, `otp_discard`.
- Sync RPCs: security invoker, `authenticated` only. `delete_my_account()`: security definer, deletes the `auth.users` row, which cascades.

## Edge Functions
- **email-otp** (`verify_jwt = false`). POST `{action: "send"|"verify", email, code?}`. Send: makes a 6-digit code, stores an HMAC-SHA256 of `email:code`, emails it by Gmail SMTP, discards the row if mail fails. Verify: checks the code, creates the user if new, mints a session through an admin magic-link exchange, returns tokens and user id/email. SQL enforces: 5 minute expiry, 2 minute resend gap, 5 per hour and 10 per day per email, 20 per hour per IP, lock after 5 wrong guesses, single use. CORS allows one hard-coded GitHub Pages origin, which a new project must change. Env names: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_PEPPER`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`.
- **delete-account** (`verify_jwt = true`). Calls `delete_my_account()` as the caller. Reads no env var by name.

## Auth providers and redirects
- `config.toml` (local stack only): email sign-up on, confirmations off, OTP length 6, expiry 300 s. SMS, Apple and anonymous sign-in off. No Google block.
- The app signs in with Google by ID-token exchange. Whether the Google provider is enabled on the hosted project isn't in the repo.
- Redirects in the file: `site_url` `http://127.0.0.1:3000`, `additional_redirect_urls` `["https://127.0.0.1:3000"]`.

`config.toml` references `seed.sql`, which doesn't exist.
