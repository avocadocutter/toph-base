-- skill-pal-creator initial schema

create extension if not exists "uuid-ossp";

-- Workspaces (team/organization container)
create table workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  created_at timestamptz default now()
);

-- Lessons (the main content unit)
create table lessons (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner_id uuid not null references users(id),
  title text not null default 'Untitled Lesson',
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'published')),
  source text not null default 'human_generated'
    check (source in ('ai_generated', 'human_generated')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Append-only snapshot history (git-inspired)
create table lesson_snapshots (
  id uuid primary key default uuid_generate_v4(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  parent_id uuid references lesson_snapshots(id),
  branch_name text not null,
  content jsonb not null,
  author_id uuid not null references users(id),
  message text not null default 'Auto-checkpoint',
  created_at timestamptz default now()
);

-- Named branch HEAD pointers
create table lesson_branches (
  id uuid primary key default uuid_generate_v4(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  branch_name text not null,
  head_snapshot_id uuid not null references lesson_snapshots(id),
  owner_id uuid not null references users(id),
  created_at timestamptz default now(),
  unique(lesson_id, branch_name)
);

-- Collaborators invited to a lesson
create table lesson_collaborators (
  lesson_id uuid not null references lessons(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'collaborator'
    check (role in ('collaborator', 'viewer')),
  invited_by uuid not null references users(id),
  created_at timestamptz default now(),
  primary key (lesson_id, user_id)
);

-- Proposals (the "pull request" equivalent)
create table proposals (
  id uuid primary key default uuid_generate_v4(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  author_id uuid not null references users(id),
  title text not null,
  description text,
  base_snapshot_id uuid not null references lesson_snapshots(id),
  head_snapshot_id uuid not null references lesson_snapshots(id),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id)
);

-- Per-block comments on proposals
create table proposal_comments (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  author_id uuid not null references users(id),
  content text not null,
  block_id text,
  parent_comment_id uuid references proposal_comments(id),
  created_at timestamptz default now()
);

-- Auto-update lessons.updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger lessons_updated_at
  before update on lessons
  for each row execute function update_updated_at();
