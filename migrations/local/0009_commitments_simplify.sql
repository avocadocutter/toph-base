-- Simplify commitments: reflection is now optional (user can skip),
-- and we no longer collect study schedule or accountability partner.
alter table user_commitments
  alter column why_message   drop not null,
  alter column days_per_week drop not null;

alter table user_commitments
  drop constraint if exists user_commitments_days_per_week_check;
