-- Treasure chests. Run once in the Supabase SQL editor (after schema_challenges.sql).
-- Three chests are dropped near the player; each pays 5 AZM once a day. The app signs a claim for 'treasure-1',
-- 'treasure-2' or 'treasure-3', and the admin portal pays it. These rows are not shown on the Quests tab (the app
-- only lists metrics it knows), and each slot can be claimed once per UTC day, so a wallet can earn at most 15 AZM a day.

alter table public.challenges drop constraint if exists challenges_metric_check;
alter table public.challenges add constraint challenges_metric_check
  check (metric in ('mapping_minutes', 'new_cells', 'satellite_passes', 'chests_opened', 'treasure'));

insert into public.challenges (id, title, blurb, period, metric, goal, reward, go_tab, sort) values
  ('treasure-1', 'Treasure chest 1', 'Opened on the map.', 'daily', 'treasure', 1, 5, 'Map', 900),
  ('treasure-2', 'Treasure chest 2', 'Opened on the map.', 'daily', 'treasure', 1, 5, 'Map', 901),
  ('treasure-3', 'Treasure chest 3', 'Opened on the map.', 'daily', 'treasure', 1, 5, 'Map', 902)
on conflict (id) do nothing;
