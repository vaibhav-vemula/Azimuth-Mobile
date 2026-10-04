-- Azimuth review queue. Run this once in the Supabase SQL editor.
--
-- Flow: the verifier service writes accepted reports and the rewards they earned as 'pending'.
-- You review them in the dashboard and set status to 'approved' or 'rejected'.
-- A weekly script pays the approved ones and marks them 'paid' with the transaction signature.

create table if not exists public.reports (
  hash        text primary key,
  node        text        not null,
  type        text        not null,
  received_at timestamptz not null,
  -- The signed report as received. Replaced with {"deleted": true} when the owner asks for deletion.
  body        jsonb       not null,
  summary     jsonb       not null default '{}'::jsonb
);
create index if not exists reports_node_idx on public.reports (node, received_at desc);

create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  node        text        not null,
  report_hash text        not null references public.reports (hash),
  kind        text        not null check (kind in ('new-cells', 'chest')),
  ref         text        not null default '',
  amount_usdc numeric(18, 6) not null check (amount_usdc > 0),
  status      text        not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  note        text,
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  paid_at     timestamptz,
  tx          text,
  unique (report_hash, kind, ref)
);
create index if not exists rewards_status_idx on public.rewards (status, created_at);
create index if not exists rewards_node_idx on public.rewards (node);

-- Stamp approval time automatically when you flip a row to approved in the dashboard.
create or replace function public.stamp_reward_status() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := now();
  end if;
  -- A paid reward must have a transaction, and a paid reward can never change again.
  if old.status = 'paid' and new.status is distinct from 'paid' then
    raise exception 'a paid reward cannot be changed';
  end if;
  if new.status = 'paid' and (new.tx is null or new.paid_at is null) then
    raise exception 'a paid reward needs a transaction and a time';
  end if;
  return new;
end $$;

drop trigger if exists rewards_status_trigger on public.rewards;
create trigger rewards_status_trigger before update on public.rewards
  for each row execute function public.stamp_reward_status();

-- What the next weekly payout will send: approved and not yet paid, one line per wallet.
create or replace view public.weekly_payable as
  select node, sum(amount_usdc) as total_usdc, count(*) as rewards
  from public.rewards
  where status = 'approved'
  group by node
  order by total_usdc desc;

-- Lock everything down. The app never talks to these tables; only the verifier service does, with the
-- service-role key, which bypasses row-level security. With no policies, the public (anon) key sees nothing.
alter table public.reports enable row level security;
alter table public.rewards enable row level security;
revoke all on public.reports, public.rewards from anon, authenticated;
revoke all on public.weekly_payable from anon, authenticated;
