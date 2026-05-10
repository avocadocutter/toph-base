create type subscription_status as enum ('FREE', 'ACTIVE', 'CANCELLED', 'PAST_DUE');
create type sandbox_status     as enum ('CREATING', 'READY', 'IDLE', 'REAPED', 'ERROR');

create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text unique not null,
  created_at          timestamptz default now(),
  stripe_customer_id  text unique,
  subscription_status subscription_status default 'FREE'
);

create table sandbox_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  course_slug       text not null,
  module_slug       text not null,
  lesson_slug       text not null,
  e2b_sandbox_id    text unique,
  status            sandbox_status default 'CREATING',
  created_at        timestamptz default now(),
  last_heartbeat_at timestamptz default now(),
  destroyed_at      timestamptz
);

create index on sandbox_sessions(user_id, lesson_slug);
create index on sandbox_sessions(status, last_heartbeat_at);

create table user_progress (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  course_slug text not null,
  module_slug text not null,
  lesson_slug text not null,
  completed_at timestamptz,
  started_at   timestamptz default now(),
  attempts     int default 0,
  unique(user_id, course_slug, module_slug, lesson_slug)
);

create index on user_progress(user_id, course_slug);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table profiles         enable row level security;
alter table sandbox_sessions enable row level security;
alter table user_progress    enable row level security;

grant select, insert, update, delete on table profiles         to anon, authenticated, service_role;
grant select, insert, update, delete on table sandbox_sessions to anon, authenticated, service_role;
grant select, insert, update, delete on table user_progress    to anon, authenticated, service_role;

create policy "users can read own profile"
  on profiles for select using (id = auth.uid());
create policy "users can update own profile"
  on profiles for update using (id = auth.uid());

create policy "users can read own sandbox sessions"
  on sandbox_sessions for select using (user_id = auth.uid());
create policy "users can insert own sandbox sessions"
  on sandbox_sessions for insert with check (user_id = auth.uid());
create policy "users can update own sandbox sessions"
  on sandbox_sessions for update using (user_id = auth.uid());

create policy "users can read own progress"
  on user_progress for select using (user_id = auth.uid());
create policy "users can insert own progress"
  on user_progress for insert with check (user_id = auth.uid());
create policy "users can update own progress"
  on user_progress for update using (user_id = auth.uid());
