-- -- Row Level Security policies

-- alter table workspaces enable row level security;
-- alter table lessons enable row level security;
-- alter table lesson_snapshots enable row level security;
-- alter table lesson_branches enable row level security;
-- alter table lesson_collaborators enable row level security;
-- alter table proposals enable row level security;
-- alter table proposal_comments enable row level security;

-- -- ── workspaces ──────────────────────────────────────────────────────────────

-- create policy "workspaces: owner all"
--   on workspaces for all
--   using (owner_id = auth.uid());

-- -- ── lesson_collaborators (must be simple to avoid circular deps) ─────────────

-- create policy "collaborators: see own + owner sees all"
--   on lesson_collaborators for select
--   using (
--     user_id = auth.uid() or
--     invited_by = auth.uid() or
--     exists (select 1 from lessons where id = lesson_id and owner_id = auth.uid())
--   );

-- create policy "collaborators: owner manages"
--   on lesson_collaborators for insert update delete
--   using (
--     exists (select 1 from lessons where id = lesson_id and owner_id = auth.uid())
--   );

-- -- ── lessons ──────────────────────────────────────────────────────────────────

-- create policy "lessons: owner all"
--   on lessons for all
--   using (owner_id = auth.uid());

-- create policy "lessons: collaborator read"
--   on lessons for select
--   using (
--     exists (
--       select 1 from lesson_collaborators
--       where lesson_id = lessons.id and user_id = auth.uid()
--     )
--   );

-- create policy "lessons: collaborator status update"
--   on lessons for update
--   using (
--     exists (
--       select 1 from lesson_collaborators
--       where lesson_id = lessons.id and user_id = auth.uid()
--         and role = 'collaborator'
--     )
--   );

-- -- ── lesson_snapshots ─────────────────────────────────────────────────────────

-- create policy "snapshots: lesson owner all"
--   on lesson_snapshots for all
--   using (
--     exists (select 1 from lessons where id = lesson_id and owner_id = auth.uid())
--   );

-- create policy "snapshots: collaborator read"
--   on lesson_snapshots for select
--   using (
--     exists (
--       select 1 from lesson_collaborators
--       where lesson_id = lesson_snapshots.lesson_id and user_id = auth.uid()
--     )
--   );

-- create policy "snapshots: branch owner write"
--   on lesson_snapshots for insert
--   with check (
--     author_id = auth.uid() and
--     exists (
--       select 1 from lesson_branches
--       where lesson_id = lesson_snapshots.lesson_id
--         and branch_name = lesson_snapshots.branch_name
--         and owner_id = auth.uid()
--     )
--   );

-- -- ── lesson_branches ──────────────────────────────────────────────────────────

-- create policy "branches: lesson owner all"
--   on lesson_branches for all
--   using (
--     exists (select 1 from lessons where id = lesson_id and owner_id = auth.uid())
--   );

-- create policy "branches: branch owner manage"
--   on lesson_branches for all
--   using (owner_id = auth.uid());

-- create policy "branches: collaborator read"
--   on lesson_branches for select
--   using (
--     exists (
--       select 1 from lesson_collaborators
--       where lesson_id = lesson_branches.lesson_id and user_id = auth.uid()
--     )
--   );

-- -- ── proposals ────────────────────────────────────────────────────────────────

-- create policy "proposals: lesson owner all"
--   on proposals for all
--   using (
--     exists (select 1 from lessons where id = lesson_id and owner_id = auth.uid())
--   );

-- create policy "proposals: author manage own"
--   on proposals for all
--   using (author_id = auth.uid());

-- create policy "proposals: collaborator read"
--   on proposals for select
--   using (
--     exists (
--       select 1 from lesson_collaborators
--       where lesson_id = proposals.lesson_id and user_id = auth.uid()
--     )
--   );

-- -- ── proposal_comments ────────────────────────────────────────────────────────

-- create policy "comments: read if lesson access"
--   on proposal_comments for select
--   using (
--     exists (
--       select 1 from proposals p
--       join lessons l on l.id = p.lesson_id
--       where p.id = proposal_id and (
--         l.owner_id = auth.uid() or
--         exists (
--           select 1 from lesson_collaborators
--           where lesson_id = l.id and user_id = auth.uid()
--         )
--       )
--     )
--   );

-- create policy "comments: author insert"
--   on proposal_comments for insert
--   with check (author_id = auth.uid());

-- create policy "comments: author manage own"
--   on proposal_comments for update delete
--   using (author_id = auth.uid());
