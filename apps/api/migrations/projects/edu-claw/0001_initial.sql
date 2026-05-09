create type subscription_status as enum ('FREE', 'ACTIVE', 'CANCELLED', 'PAST_DUE');
create type sandbox_status     as enum ('CREATING', 'READY', 'IDLE', 'REAPED', 'ERROR');

create table profiles (
  id                  text primary key,           -- Clerk userId
  email               text unique not null,
  created_at          timestamptz default now(),
  stripe_customer_id  text unique,
  subscription_status subscription_status default 'FREE'
);

create table sandbox_sessions (
  id                text primary key default gen_random_uuid()::text,
  user_id           text not null references profiles(id) on delete cascade,
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
  id          text primary key default gen_random_uuid()::text,
  user_id     text not null references profiles(id) on delete cascade,
  course_slug text not null,
  module_slug text not null,
  lesson_slug text not null,
  completed_at timestamptz,
  started_at   timestamptz default now(),
  attempts     int default 0,
  unique(user_id, course_slug, module_slug, lesson_slug)
);

create index on user_progress(user_id, course_slug);

-- RLS enabled but all access goes through service-role (bypasses RLS)
-- Policies defined as defense-in-depth if anon key ever leaks
alter table profiles         enable row level security;
alter table sandbox_sessions enable row level security;
alter table user_progress    enable row level security;
