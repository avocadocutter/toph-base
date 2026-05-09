-- Grant table privileges to PostgREST roles.
-- service_role bypasses RLS; authenticated/anon are used for direct client queries.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

grant select on all tables in schema public to anon;
