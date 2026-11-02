-- C14: a Google sign-in already carries a name (and Supabase's GoTrue stores it on
-- `auth.users.raw_user_meta_data` automatically from the ID token's own claims); an
-- email-code sign-in carries nothing but the address. This closes that gap with a short,
-- once-per-account "tell us about yourself" step (ProfileSetupScreen) collected for every new
-- account regardless of sign-in method, so personalization doesn't quietly depend on which one
-- someone picked. Same client-writable shape as `display_name` (protect_profile_columns() in
-- 0005_rls.sql only locks plan/entitlement_expires_at/entry_count -- these three join
-- display_name as ordinary, RLS-protected, user-owned columns, no trigger change needed).

alter table public.profiles
  add column age        smallint check (age is null or age between 13 and 120),
  add column location    text     check (location is null or char_length(location) <= 80),
  add column occupation  text     check (occupation is null or occupation in (
    'Student', 'Software / IT', 'Business owner', 'Doctor / Healthcare', 'Teacher / Educator',
    'Engineer', 'Finance / Banking', 'Government employee', 'Homemaker', 'Retired',
    'Freelancer', 'Sales / Marketing', 'Artist / Creative', 'Farmer', 'Other'
  ));
