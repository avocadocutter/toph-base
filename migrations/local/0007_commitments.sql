create table user_commitments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  course_slug         text not null,
  why_message         text not null,
  days_per_week       int  not null check (days_per_week between 1 and 7),
  accountability_name text,
  signed_at           timestamptz default now(),
  unique(user_id, course_slug)
);
create index on user_commitments(user_id, course_slug);
alter table user_commitments enable row level security;
create policy "users can read own commitments"   on user_commitments for select using (user_id = auth.uid());
create policy "users can insert own commitments" on user_commitments for insert with check (user_id = auth.uid());
create policy "users can update own commitments" on user_commitments for update using (user_id = auth.uid());
grant select, insert, update, delete on table user_commitments to anon, authenticated, service_role;
