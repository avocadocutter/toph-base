-- Upserts a progress row and increments attempt count atomically
create or replace function increment_attempts(
  p_user_id     text,
  p_course_slug text,
  p_module_slug text,
  p_lesson_slug text
) returns void
language plpgsql
security definer
as $$
begin
  insert into user_progress (user_id, course_slug, module_slug, lesson_slug, attempts)
  values (p_user_id, p_course_slug, p_module_slug, p_lesson_slug, 1)
  on conflict (user_id, course_slug, module_slug, lesson_slug)
  do update set attempts = user_progress.attempts + 1;
end;
$$;
