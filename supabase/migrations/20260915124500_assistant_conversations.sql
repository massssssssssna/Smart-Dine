create table if not exists private.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references private.profiles(id),
  title text not null check (length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists assistant_conversations_actor_updated_idx
  on private.assistant_conversations(actor_id, updated_at desc) where deleted_at is null;

create table if not exists private.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references private.assistant_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 8000),
  run_id uuid references private.assistant_runs(id),
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_conversation_created_idx
  on private.assistant_messages(conversation_id, created_at, id);

alter table private.assistant_conversations enable row level security;
alter table private.assistant_messages enable row level security;
revoke all on private.assistant_conversations, private.assistant_messages from public, anon, authenticated;
grant select, insert, update, delete on private.assistant_conversations, private.assistant_messages to service_role;

