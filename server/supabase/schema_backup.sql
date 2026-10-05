-- Azimuth encrypted progress backup. Run this once in the Supabase SQL editor (after schema_direct.sql).
--
-- What is stored: the user's map progress, compressed and ENCRYPTED on the phone with a key made from the wallet's own
-- signature. Supabase only ever holds scrambled bytes and cannot read them, even with the service key.
--
-- What the public (anon) key may do:
--   * add a backup row                         (table backups, insert only, limited columns)
--   * fetch a wallet's latest backup           (function fetch_backup, needs the wallet's secret lookup tag)
-- It cannot list, read or change any other row.
--
-- Why strangers cannot damage a real backup: every row carries a "tag" that is derived from the wallet's signature, so
-- only the wallet owner knows it. Fetching needs the tag. Pruning only touches rows with the same wallet AND tag. A
-- stranger could add junk rows under someone's wallet address but with a tag of their own, which are never fetched and
-- never push out the real rows. A restore also checks that the data decrypts, so junk is ignored either way.

create table if not exists public.backups (
  id         uuid primary key default gen_random_uuid(),
  node       text not null check (node ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  tag        text not null check (tag ~ '^[0-9a-f]{32}$'),
  -- base64 of nonce + ciphertext. About 4 MB is room for a very large map.
  payload    text not null check (length(payload) between 40 and 4000000),
  created_at timestamptz not null default now()
);
create index if not exists backups_lookup_idx on public.backups (node, tag, created_at desc);

-- Flood limits: per wallet, and overall. These run as the table owner (security definer) because the public key cannot read
-- the table itself, and counting rows needs read access.
create or replace function public.limit_backup_inserts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.backups where node = new.node and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many backups from this wallet this hour' using errcode = 'P0001';
  end if;
  if (select count(*) from public.backups where created_at > now() - interval '1 minute') >= 120 then
    raise exception 'the service is busy, try again shortly' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists backups_limit_trigger on public.backups;
create trigger backups_limit_trigger before insert on public.backups
  for each row execute function public.limit_backup_inserts();

-- Keep only the three newest rows for each wallet + tag, so storage stays bounded.
create or replace function public.prune_backups() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.backups b
  where b.node = new.node and b.tag = new.tag
    and b.id not in (select id from public.backups where node = new.node and tag = new.tag order by created_at desc limit 3);
  return null;
end $$;
drop trigger if exists backups_prune_trigger on public.backups;
create trigger backups_prune_trigger after insert on public.backups
  for each row execute function public.prune_backups();

alter table public.backups enable row level security;
revoke all on public.backups from anon, authenticated;
grant insert (node, tag, payload) on public.backups to anon;
drop policy if exists backups_insert_public on public.backups;
create policy backups_insert_public on public.backups for insert to anon with check (true);

-- The latest backup for a wallet and tag, or nothing.
create or replace function public.fetch_backup(p_node text, p_tag text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('payload', payload, 'created_ms', (extract(epoch from created_at) * 1000)::bigint)
  from public.backups where node = p_node and tag = p_tag
  order by created_at desc limit 1;
$$;
revoke all on function public.fetch_backup(text, text) from public;
grant execute on function public.fetch_backup(text, text) to anon;
