-- Performance indexes

create index on lesson_snapshots(lesson_id, branch_name, created_at desc);
create index on lesson_snapshots(lesson_id, parent_id);
create index on lesson_branches(lesson_id);
create index on lesson_branches(owner_id);
create index on lesson_collaborators(user_id);
create index on proposals(lesson_id, status);
create index on proposals(author_id);
create index on proposal_comments(proposal_id);
create index on proposal_comments(block_id) where block_id is not null;
create index on lessons(owner_id, updated_at desc);
create index on lessons(status);
