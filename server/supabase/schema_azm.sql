-- AZMTest on-chain payouts. Run once in the Supabase SQL editor (after schema_direct.sql).
alter table public.reports add column if not exists onchain_tx text;
alter table public.reports add column if not exists onchain_record text;
alter table public.reports add column if not exists onchain_error text;
alter table public.reports add column if not exists onchain_amount integer;
create index if not exists reports_onchain_idx on public.reports (status, onchain_tx) where onchain_amount > 0;

-- node_summary now also lists the wallet's reports that were recorded on-chain. The public key still cannot read
-- the reports table; only these few fields of a wallet's own recorded reports come out, like the reward totals.
create or replace function public.node_summary(p_node text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'address', p_node,
    'pendingReports',  (select count(*) from public.reports where node = p_node and status = 'new'),
    'rejectedReports', (select count(*) from public.reports where node = p_node and status = 'rejected'),
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
      select jsonb_agg(jsonb_build_object('hash', v.hash, 'type', v.type, 'amount', v.onchain_amount, 'record', v.onchain_record, 'verified_ms', (extract(epoch from v.verified_at) * 1000)::bigint) order by v.verified_at desc)
      from (select hash, type, onchain_amount, onchain_record, verified_at from public.reports where node = p_node and onchain_record is not null order by verified_at desc limit 50) v
    ), '[]'::jsonb)
  )
  from public.rewards where node = p_node;
$$;
revoke all on function public.node_summary(text) from public;
grant execute on function public.node_summary(text) to anon;
