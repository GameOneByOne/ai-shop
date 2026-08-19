create type task_status as enum ('todo','doing','done','cancelled');
create table tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sku_id uuid references skus(id) on delete set null, source text not null, title text not null,
  description text, priority text not null check(priority in ('P0','P1','P2','P3')),
  status task_status not null default 'todo', suggested_by_ai boolean not null default false,
  ai_analysis_id uuid references ai_analyses(id) on delete set null,
  created_at timestamptz not null default now(), due_date date, completed_at timestamptz
);
create index tasks_user_status_idx on tasks(user_id,status,created_at desc);
alter table tasks enable row level security;
create policy "own tasks" on tasks for all using(user_id=auth.uid()) with check(user_id=auth.uid());
