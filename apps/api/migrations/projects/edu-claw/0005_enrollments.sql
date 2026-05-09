create type payment_status as enum ('free', 'pending', 'paid', 'refunded');

create table user_enrollments (
  id                          text primary key default gen_random_uuid()::text,
  user_id                     text not null references profiles(id) on delete cascade,
  course_slug                 text not null,
  enrolled_at                 timestamptz default now(),
  price_paid                  numeric(10,2) not null default 0,
  currency                    text not null default 'mxn',
  payment_status              payment_status not null default 'free',
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  unique(user_id, course_slug)
);

create index on user_enrollments(user_id);
create index on user_enrollments(user_id, course_slug);

alter table user_enrollments enable row level security;

-- Backfill: enroll existing users in courses where they already have progress.
insert into user_enrollments (user_id, course_slug, payment_status, price_paid)
select distinct user_id, course_slug, 'free'::payment_status, 0
from user_progress
on conflict (user_id, course_slug) do nothing;
