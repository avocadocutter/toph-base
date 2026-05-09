-- RPC to upsert daily activity and increment lesson count
create or replace function upsert_activity(
  p_user_id text,
  p_date    date
) returns void
language plpgsql
security definer
as $$
begin
  insert into user_activity (user_id, activity_date, lesson_count)
  values (p_user_id, p_date, 1)
  on conflict (user_id, activity_date)
  do update set lesson_count = user_activity.lesson_count + 1;
end;
$$;
