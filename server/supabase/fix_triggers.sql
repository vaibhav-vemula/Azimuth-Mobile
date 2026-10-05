-- Fix for "permission denied for table ...": run this once in the Supabase SQL editor.
-- The flood-limit triggers count existing rows, which the public key is not allowed to read, so they must run as the
-- table owner (security definer). This replaces just those three functions; nothing else changes.

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

create or replace function public.limit_deletion_requests() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.deletion_requests where node = new.node and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many requests' using errcode = 'P0001';
  end if;
  return new;
end $$;
