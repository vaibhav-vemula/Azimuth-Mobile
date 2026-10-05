-- Azimuth direct mode: the app talks to Supabase with the PUBLISHABLE (anon) key, with no server in between.
-- Run this once in the Supabase SQL editor, AFTER schema.sql.
--
-- What the public key may do after this:
--   * read open chests                                   (table chests)
--   * insert a report, and nothing else about it         (table reports, insert only, limited columns)
--   * ask to have its data deleted                       (table deletion_requests, insert only)
--   * look up a wallet's reward totals                   (function node_summary)
-- It can read no reports, rewards or deletion requests, and cannot change or delete anything.
--
-- Everything that needs trust (signature check, plausibility, chest rules, rewards, deletion) happens later, when a
-- person reviews each submission in the admin portal (server/admin), which uses the SECRET key and runs on your
-- computer. Until a submission is approved it earns nothing.

-- ---------------------------------------------------------------------------------------------------------
-- Reports: what the app may insert, and review state
-- ---------------------------------------------------------------------------------------------------------
alter table public.reports add column if not exists status text not null default 'new'
  check (status in ('new', 'verified', 'rejected'));
alter table public.reports add column if not exists reasons jsonb;
alter table public.reports add column if not exists verified_at timestamptz;
alter table public.reports alter column received_at set default now();
alter table public.reports alter column summary set default '{}'::jsonb;
create index if not exists reports_status_idx on public.reports (status, received_at);
create index if not exists reports_received_idx on public.reports (received_at);

-- Shape limits that hold for every insert, whoever makes it.
alter table public.reports drop constraint if exists reports_shape;
alter table public.reports add constraint reports_shape check (
  hash ~ '^[0-9a-f]{64}$'
  and node ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  and type in ('mapping-session', 'chest-claim', 'satellite-pass')
  and octet_length(body::text) < 400000
);

-- Throttle floods. These limits are per claimed wallet and overall; the public key cannot be told apart by caller,
-- so the overall limit is the real protection.
create or replace function public.limit_report_inserts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.reports where node = new.node and received_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many reports from this wallet this hour' using errcode = 'P0001';
  end if;
  if (select count(*) from public.reports where received_at > now() - interval '1 minute') >= 300 then
    raise exception 'the service is busy, try again shortly' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists reports_limit_trigger on public.reports;
create trigger reports_limit_trigger before insert on public.reports
  for each row execute function public.limit_report_inserts();

-- The public key may insert only these columns. Status, review results and the time are set by the database.
revoke insert on public.reports from anon;
grant insert (hash, node, type, body) on public.reports to anon;
drop policy if exists reports_insert_public on public.reports;
create policy reports_insert_public on public.reports for insert to anon with check (status = 'new');

-- ---------------------------------------------------------------------------------------------------------
-- Chests: public to read, written only by you
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.chests (
  id             text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  title          text not null check (length(title) between 1 and 80),
  kind           text not null check (kind in ('gap', 'dead-zone', 'wifi-quality', 'visit', 'weather-radio', 'noise', 'satellite-pass', 'sonde')),
  cell_id        text not null check (cell_id ~ '^h[0-9]+:-?[0-9]+:-?[0-9]+$'),
  reward_usdc    numeric(18, 6) not null check (reward_usdc > 0),
  max_fills      int  not null check (max_fills > 0),
  fills          int  not null default 0,
  expires_at     timestamptz not null,
  requester      text not null,
  requires       text not null default 'phone' check (requires in ('phone', 'dongle')),
  spec           jsonb not null default '{}'::jsonb,
  onchain_bounty text,
  status         text not null default 'open' check (status in ('open', 'filled', 'closed')),
  created_at     timestamptz not null default now()
);
create index if not exists chests_open_idx on public.chests (status, expires_at);

alter table public.chests enable row level security;
revoke all on public.chests from anon, authenticated;
grant select on public.chests to anon;
drop policy if exists chests_read_open on public.chests;
create policy chests_read_open on public.chests for select to anon
  using (status = 'open' and expires_at > now() and fills < max_fills);

-- ---------------------------------------------------------------------------------------------------------
-- Reward totals for one wallet. Wallet addresses are already public on-chain; this shows only amounts.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.node_summary(p_node text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'address', p_node,
    -- Submissions are checked by a person. Until then they are only counted; rewards appear when approved.
    'pendingReports',  (select count(*) from public.reports where node = p_node and status = 'new'),
    'rejectedReports', (select count(*) from public.reports where node = p_node and status = 'rejected'),
    'pendingUsdc',  coalesce(sum(amount_usdc) filter (where status = 'pending'), 0),
    'approvedUsdc', coalesce(sum(amount_usdc) filter (where status = 'approved'), 0),
    'paidUsdc',     coalesce(sum(amount_usdc) filter (where status = 'paid'), 0),
    'chestsOpened', count(*) filter (where kind = 'chest' and status <> 'rejected'),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.kind, 'ref', r.ref, 'amount_usdc', r.amount_usdc, 'status', r.status, 'created_ms', (extract(epoch from r.created_at) * 1000)::bigint) order by r.created_at desc)
      from (select * from public.rewards where node = p_node order by created_at desc limit 50) r
    ), '[]'::jsonb)
  )
  from public.rewards where node = p_node;
$$;
revoke all on function public.node_summary(text) from public;
grant execute on function public.node_summary(text) to anon;

-- ---------------------------------------------------------------------------------------------------------
-- Deletion requests: signed by the wallet, checked and carried out by the review job.
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.deletion_requests (
  id         uuid primary key default gen_random_uuid(),
  node       text   not null check (node ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  issued_ms  bigint not null,
  signature  text   not null check (length(signature) between 80 and 100),
  status     text   not null default 'new' check (status in ('new', 'done', 'refused')),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists deletion_status_idx on public.deletion_requests (status, created_at);

create or replace function public.limit_deletion_requests() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.deletion_requests where node = new.node and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many requests' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists deletion_limit_trigger on public.deletion_requests;
create trigger deletion_limit_trigger before insert on public.deletion_requests
  for each row execute function public.limit_deletion_requests();

alter table public.deletion_requests enable row level security;
revoke all on public.deletion_requests from anon, authenticated;
grant insert (node, issued_ms, signature) on public.deletion_requests to anon;
drop policy if exists deletion_insert_public on public.deletion_requests;
create policy deletion_insert_public on public.deletion_requests for insert to anon with check (status = 'new');
