-- Supabase creates public.rls_auto_enable() (an event-trigger function) when
-- "Enable automatic RLS" is on. It is executable by anon and authenticated
-- through the API (/rest/v1/rpc/rls_auto_enable). Event triggers don't need
-- the caller to hold EXECUTE, so closing it changes nothing for RLS.
-- Guarded: the function doesn't exist on a plain local Postgres.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
