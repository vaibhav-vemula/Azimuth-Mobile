-- Challenge claims. Run once in the Supabase SQL editor (after schema_azm.sql).
-- A claim is a small signed report; the admin portal settles it by re-checking the wallet's verified reports.

-- The challenge list. Edit it in the Supabase table editor (the service key and the dashboard can write; the app can only read active rows).
create table if not exists public.challenges (
  id      text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  title   text not null check (length(title) between 1 and 80),
  blurb   text not null default '' check (length(blurb) <= 200),
  period  text not null check (period in ('daily', 'weekly', 'once')),
  metric  text not null check (metric in ('mapping_minutes', 'new_cells', 'satellite_passes', 'chests_opened')),
  goal    numeric not null check (goal > 0),
  reward  integer not null check (reward between 1 and 100),
  go_tab  text not null check (go_tab in ('Map', 'Satellites')),
  active  boolean not null default true,
  sort    integer not null default 0
);
alter table public.challenges enable row level security;
drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to anon using (active);
revoke all on public.challenges from anon;
grant select on public.challenges to anon;

insert into public.challenges (id, title, blurb, period, metric, goal, reward, go_tab, sort) values
  ('scan-30', 'Scan for 30 minutes', 'Keep mapping on for half an hour today.', 'daily', 'mapping_minutes', 30, 5, 'Map', 10),
  ('cells-20', 'Find 20 new cells', 'Map 20 cells nobody has mapped yet.', 'daily', 'new_cells', 20, 5, 'Map', 20),
  ('ground-weekly', 'Explore new ground', 'Reveal 70 new cells this week, about a square mile on the map grid.', 'weekly', 'new_cells', 70, 40, 'Map', 30),
  ('passes-3', 'Catch 3 satellite passes', 'Record three satellite passes this week.', 'weekly', 'satellite_passes', 3, 30, 'Satellites', 40),
  ('first-chest', 'Open your first chest', 'Find a chest and open it. Once only.', 'once', 'chests_opened', 1, 20, 'Map', 50)
on conflict (id) do nothing;

-- Claims.
alter table public.reports drop constraint if exists reports_shape;
alter table public.reports add constraint reports_shape check (
  hash ~ '^[0-9a-f]{64}$'
  and node ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  and type in ('mapping-session', 'chest-claim', 'satellite-pass', 'challenge-claim')
  and octet_length(body::text) < 400000
);

-- node_summary: everything from schema_azm.sql, plus which challenge each verified payout was for and the wallet's recent claims.
create or replace function public.node_summary(p_node text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'address', p_node,
    'pendingReports',  (select count(*) from public.reports where node = p_node and status = 'new' and type <> 'challenge-claim'),
    'rejectedReports', (select count(*) from public.reports where node = p_node and status = 'rejected' and type <> 'challenge-claim'),
    'pendingUsdc',  coalesce(sum(amount_usdc) filter (where status = 'pending'), 0),
    'approvedUsdc', coalesce(sum(amount_usdc) filter (where status = 'approved'), 0),
    'paidUsdc',     coalesce(sum(amount_usdc) filter (where status = 'paid'), 0),
    'chestsOpened', count(*) filter (where kind = 'chest' and status <> 'rejected'),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.kind, 'ref', r.ref, 'amount_usdc', r.amount_usdc, 'status', r.status, 'created_ms', (extract(epoch from r.created_at) * 1000)::bigint) order by r.created_at desc)
      from (select * from public.rewards where node = p_node order by created_at desc limit 50) r
    ), '[]'::jsonb),
    'azmTotal', (select coalesce(sum(onchain_amount), 0) from public.reports where node = p_node and onchain_record is not null),
    'verified', coalesce((
      select jsonb_agg(jsonb_build_object(
        'hash', v.hash, 'type', v.type, 'amount', v.onchain_amount, 'record', v.onchain_record,
        'verified_ms', (extract(epoch from v.verified_at) * 1000)::bigint,
        'challenge', v.challenge, 'period', v.period) order by v.verified_at desc)
      from (
        select hash, type, onchain_amount, onchain_record, verified_at,
               body->'report'->>'challengeId' as challenge, body->'report'->>'period' as period
        from public.reports where node = p_node and onchain_record is not null order by verified_at desc limit 50
      ) v
    ), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('challengeId', c.challenge, 'period', c.period, 'status', c.status, 'reasons', c.reasons) order by c.received_at desc)
      from (
        select body->'report'->>'challengeId' as challenge, body->'report'->>'period' as period, status, reasons, received_at
        from public.reports
        where node = p_node and type = 'challenge-claim' and received_at > now() - interval '10 days'
        order by received_at desc limit 50
      ) c
    ), '[]'::jsonb)
  )
  from public.rewards where node = p_node;
$$;
revoke all on function public.node_summary(text) from public;
grant execute on function public.node_summary(text) to anon;
