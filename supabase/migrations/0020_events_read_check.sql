-- Quick-log accuracy: one "read_check" event per read, holding the text the
-- person said or typed (never audio; SMS balances and account numbers cut on
-- the device), what was read, and what was saved. Approved by the owner for the
-- pilot (2026-11-20). Still capped at 1000 bytes; deleted with the account.
comment on column public.events.props is
  'Usage metrics. read_check events also hold said/read/saved for accuracy checks; other events hold no amounts or names.';
