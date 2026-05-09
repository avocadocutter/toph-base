-- Track daily learning activity for streak display
create table user_activity (
  id            text primary key default gen_random_uuid()::text,
  user_id       text not null references profiles(id) on delete cascade,
  activity_date date not null,
  lesson_count  int  not null default 0,
  unique(user_id, activity_date)
);

create index on user_activity(user_id, activity_date desc);

alter table user_activity enable row level security;
grant select, insert, update, delete on table user_activity to anon, authenticated, service_role;

-- Writes go through service-role RPCs; users only need read access.
create policy "users can read own activity"
  on user_activity for select using (user_id = auth.uid());

-- Time tracking: add time_spent_seconds to user_progress
alter table user_progress
  add column if not exists time_spent_seconds int not null default 0;
