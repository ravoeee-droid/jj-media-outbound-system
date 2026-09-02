-- JJ-Media WhatsApp: server-only tables. No anonymous or authenticated REST access.
create table public.jj_whatsapp_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  phone text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  mode text not null default 'copilot' check (mode in ('manual','copilot','autopilot')),
  consent text not null default 'unknown' check (consent in ('unknown','granted','revoked')),
  consent_note text not null default '', consent_at timestamptz,
  status text not null default 'open' check (status in ('open','handoff','closed','booked')),
  handoff_reason text not null default '', summary text not null default '', intent text not null default '',
  unread boolean not null default false, version integer not null default 0,
  last_message_at timestamptz, last_inbound_id uuid,
  offered_slots jsonb not null default '[]', operator_slots jsonb not null default '[]',
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create unique index jj_wa_phone_unique on public.jj_whatsapp_threads(workspace_id, phone);
create unique index jj_wa_lead_unique on public.jj_whatsapp_threads(workspace_id, lead_id);
create index jj_wa_inbox_idx on public.jj_whatsapp_threads(workspace_id, last_message_at);
create index jj_wa_lead_fk_idx on public.jj_whatsapp_threads(lead_id);

create table public.jj_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  kind text not null default 'text', status text not null default 'draft',
  body text not null default '', provider_id text, idempotency_key text not null, source_id uuid,
  metadata jsonb not null default '{}', sent_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.jj_whatsapp_threads(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);
create unique index jj_wa_message_key_unique on public.jj_whatsapp_messages(workspace_id, idempotency_key);
create unique index jj_wa_provider_unique on public.jj_whatsapp_messages(workspace_id, provider_id);
create index jj_wa_history_idx on public.jj_whatsapp_messages(workspace_id, thread_id, created_at);
create index jj_wa_message_thread_fk_idx on public.jj_whatsapp_messages(thread_id, workspace_id);

create table public.jj_whatsapp_locks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null, token uuid not null, expires_at timestamptz not null,
  primary key (workspace_id, key)
);

create table public.jj_whatsapp_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','cancelled','skipped','review','unknown')),
  message_id uuid references public.jj_whatsapp_messages(id) on delete set null,
  error text not null default '', attempted_at timestamptz, sent_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.jj_whatsapp_threads(id, workspace_id) on delete cascade
);
create unique index jj_wa_queue_thread_unique on public.jj_whatsapp_queue(workspace_id, thread_id);
create index jj_wa_queue_due_idx on public.jj_whatsapp_queue(workspace_id, status, created_at);
create index jj_wa_queue_day_idx on public.jj_whatsapp_queue(workspace_id, attempted_at);
create index jj_wa_queue_thread_fk_idx on public.jj_whatsapp_queue(thread_id, workspace_id);
create index jj_wa_queue_message_fk_idx on public.jj_whatsapp_queue(message_id);

create table public.jj_whatsapp_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null, calendar_id text not null, event_id text not null,
  start_at timestamptz not null, end_at timestamptz not null check (end_at > start_at),
  status text not null default 'reserved' check (status in ('reserved','unknown','confirmed','retrying')),
  join_url text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id) references public.jj_whatsapp_threads(id, workspace_id) on delete cascade
);
create unique index jj_wa_reservation_event_unique on public.jj_whatsapp_reservations(workspace_id, event_id);
create index jj_wa_reservation_idx on public.jj_whatsapp_reservations(workspace_id, calendar_id, start_at);
create index jj_wa_reservation_thread_fk_idx on public.jj_whatsapp_reservations(thread_id, workspace_id);

alter table public.jj_whatsapp_threads enable row level security;
alter table public.jj_whatsapp_messages enable row level security;
alter table public.jj_whatsapp_locks enable row level security;
alter table public.jj_whatsapp_queue enable row level security;
alter table public.jj_whatsapp_reservations enable row level security;
revoke all on public.jj_whatsapp_threads, public.jj_whatsapp_messages, public.jj_whatsapp_locks, public.jj_whatsapp_queue, public.jj_whatsapp_reservations from anon, authenticated;

