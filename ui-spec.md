# UI Spec — Expense Tracker (shared front end)

Applies to both the personal tracker (make.com backend, 3 fixed accounts) and the Expense Tracker APK (Supabase backend, N accounts). Front end is the same; backend/values differ per app.

## Nav — 3 tabs
Add Payment | History | Stats

---

## 1. Add Payment

Order on screen, top to bottom:
1. Amount — with the Credit / Debit pair, unchanged
2. Account — 3 fixed chips for personal (N accounts, seeded Domestic/International/Cash, for APK) plus the Self transfer switch and its To account row
3. Category — what kind of transaction it was (Payment, Refund, Sent/Received Transfer, Custom…). Splits into a sent leg and a received leg while Self transfer is on
4. Transaction name
5. Note (optional)
6. Date (defaults to today)
7. **Will I get this back?**

**Will I get this back?** — Yes / No buttons.
- No → nothing further; the entry is written with an `N` id.
- Yes → dropdown: New / Old.
  - New → a fresh `Y` id is minted.
  - Old → lists **currently-open** items by expense name (with amount and date); picking one reuses its id, which closes the pair. (This picker only ever shows open items — closed ones drop out immediately, unlike the Owed to me tab below.)

Replaces the old raw alphanumeric transaction-ID field. The id still exists underneath and is shown in the confirm sheet; it is never typed. Hidden entirely while Self transfer is on — a transfer is tracked with a Y id automatically.

~~⚠️ Open: frequency field removal~~ **Settled 21 Sep 2026.** The `TRANSACTION KIND` column was deleted from the Excel sheet, so the field is gone from the form and the column is gone from the payload. The table is now 9 columns, B through J.

---

## 2. History

- Day-grouped transaction log, each day its own rounded card with a gap between cards.
- Transactions within a day: tight spacing.
- Month toggle control at top — UI present, non-functional for now (stub).

### Owed to me — nested sub-tab inside History

**Changed 24–25 Sep 2026.** One list, no second tab inside it. Every `Y` id ever seen — open or settled — shown once, split into two sections, each its **own rounded card with a gap between them** (same shape as a day card in Recent, not one continuous list):

- **Open** card, on top. Items sorted newest-opened-first. Each row: name, amount, account, "Opened `<date>`". Normal styling.
- **Closed** card, below. Items sorted newest-closed-first. Each row: same fields plus "Opened `<date>` · Closed `<date>`". Grayed out (~55% opacity, muted tile/tags) so open and settled are never confused at a glance.

The tab badge counts only the Open section.

**Rows are tappable**, same as Recent — tapping opens the entry-detail sheet described below. An open item opens its (only) leg; a closed item opens the close (repayment) leg by default, since that's the more likely one to need a fix — the Open/Close toggle inside the detail sheet reaches the other leg.

### Entry detail (tap any row, Recent or Owed to me)

Opens a sheet with the entry's fields, plus:
- **✕** top-right — the only "just close this" affordance.
- **Delete** / **Edit** — one row, split 50/50. No separate bottom Close button.

**Added 24 Sep 2026.** Delete confirms first, then:
- Not yet synced → dropped from the local queue, no network call.
- Already synced → server re-read to find the current row index, then removed there.
- A self transfer (paired legs) deletes **both** legs together.
- Local history, pending edits and any cache of the row are pruned afterward, and open-`Y` bookkeeping is rebuilt.

**Open/Close leg toggle — added 25 Sep 2026.** When the tapped entry's `Y` id has both an open and a close leg on this device, a small two-way toggle appears top-right, immediately left of the ✕ (with a gap between the two so they read as a group), and the title reserves extra right-side padding so the transaction name never runs under it. Labelled **Open** / **Close**, dark-on-light-off styling (same language as other toggles, sized smaller). Whichever side is selected is what Edit and Delete act on — so you can, say, delete just the repayment leg (which reopens the loan) or just the original loan leg (which leaves the repayment, if any, orphaned — no automatic cascade), independently, from the same popup. Defaults to whichever leg was tapped. Not shown for a `Y` id with only one leg, or for anything that isn't a `Y` id.

For the APK backend this maps directly onto Stage 2.3's `delete` operation — soft-delete by id, cascade to the whole `transfer_group` for self transfers. No index-matching or re-read needed there since rows have real server ids; that whole "re-read to find the index" dance is a spreadsheet-only workaround. The open/close leg toggle is pure UI state (which of two already-fetched rows is being edited) and needs no backend change to carry over.

---

## 3. Stats

### Personal tracker (fixed 3 accounts)
Exactly 5 tiles, always live:
1. Domestic balance
2. International balance
3. Cash balance
4. Total spent
5. Total have

**Where the numbers come from.** Row 5 of the month sheet is the source of truth, because rollover rows and anything typed straight into Excel exist only there:

| cell | tile |
|---|---|
| B5 | Domestic balance |
| C5 | International balance |
| D5 | Cash balance |
| E5 | Total have |
| H5 | Domestic expenses |
| I5 | Cash expenses |
| J5 | Total spent (net expenses) |

Balance tiles (B/C/D/E) are still summed client-side from synced rows — not yet pulled from the sheet snapshot.

**Total spent (J5) — wired up 24–25 Sep 2026.** `MODE=stats` (`GET` on worksheet range `B5:J5`) existed on the Make side from the start but the app never called it; total spent was being summed client-side instead, which drifted from the sheet whenever something was typed straight into Excel (rollovers, manual fixes). Now: pulling a month (the same "Read from sheet" button History/Stats already share) also fetches `B5:J5` and caches `J5` per sheet (`ledger.statsSnapshot.v1`). The tile shows that cached `J5` plus spend from any entry this device holds that isn't reflected in the sheet yet (i.e. not `src:'sheet'`). No snapshot yet for a month → falls back to the old full client-side sum. **Not automatic/nightly** — it refreshes only when that month is pulled, same as the table.

### APK (N accounts, generalized)
- **1–3 accounts:** N balance tiles shown directly + Total spent + Total have (always pinned).
- **4+ accounts:** balance tiles collapse into an "Accounts ▾" dropdown/expandable (each shows its balance on expand) + Total spent + Total have stay pinned outside it. *Not built — no 4th account exists yet.*
- Multi-currency: deferred, not in launch scope.
- Total spent should come from a server-computed total (the Postgres equivalent of J5 — e.g. a `SUM` over non-transfer debits for the period), not summed in the client, for the same reason it was just fixed on the personal tracker: client-side sums silently drift from anything written outside the normal insert path.

---

## What changed from the old design
- 10 form fields → 6 + the Yes/No mechanic, reordered so the amount comes first.
- Raw transaction ID → Yes/No + New/Old-by-name.
- 2 tabs → 3 tabs (History split out, Stats is its own screen).
- Frequency dropped from the form and from the sheet.
- Stats: total spent now sourced from the sheet's own J5 total on each pull, not summed client-side (24–25 Sep 2026); other tiles still client-summed.
- Stats: hardcoded 3 accounts (personal) generalized to N accounts with a cap rule (APK).
- History: entry detail now has Delete alongside Edit (24 Sep 2026).
- Owed to me: one list, Open and Closed each their own card with a gap between, closed items grayed out rather than hidden (24–25 Sep 2026).
- Entry detail: rows tap open from Owed to me too, and a settled `Y` entry gets a small Open/Close toggle (top-right, beside ✕) to edit or delete either leg independently (25 Sep 2026).
