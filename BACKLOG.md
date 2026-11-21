# Backlog (parked on purpose)

Build before real users:
- **Email sign-in codes.** New free Gmail for the app. Add secrets `OTP_PEPPER`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` in Supabase. Then test.

Build later:
- **Offline save.** On a failed save, keep the form filled, show "Not saved, no connection", one-tap retry. No queue.
- **Admin "Today" card** in Usage metrics: entries today, AI calls today, users active today. AI allowance and DB size stay in the Cloudflare and Supabase dashboards.

Optional:
- Deploy the Granite fallback (`_shared/ai.ts`) to the live AI functions.
- Turn on leaked-password protection (Supabase Auth).
