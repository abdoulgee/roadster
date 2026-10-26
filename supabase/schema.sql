-- Drive Roadster online leaderboard.
--
-- Run this once in the Supabase SQL editor (or `psql -f`). The browser never touches the tables
-- directly: row-level security is on with no policies, and every action goes through the
-- SECURITY DEFINER functions below, which check the player's secret and sanity-check each run.
-- Uses only built-ins (Postgres 13+), so it does not depend on where extensions are installed.

-- ---------- tables ----------

create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  secret_hash text not null,
  callsign    text not null,
  region      text,
  created_at  timestamptz not null default now(),
  constraint callsign_format check (callsign ~ '^[A-Za-z0-9_.-]{2,12}$'),
  constraint region_format check (region is null or region ~ '^[A-Z]{2}$')
);

create unique index if not exists players_callsign_key on public.players (lower(callsign));

create table if not exists public.runs (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players (id) on delete cascade,
  seed         bigint,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  distance     integer,
  score        integer,
  duration     real,
  max_streak   integer
);

create index if not exists runs_player_idx on public.runs (player_id);
create index if not exists runs_submitted_idx on public.runs (submitted_at) where submitted_at is not null;

alter table public.players enable row level security;
alter table public.runs enable row level security;
revoke all on public.players, public.runs from anon, authenticated;

-- ---------- helpers ----------

create or replace function public.dr_hash(p_secret text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')
$$;

create or replace function public.dr_check_callsign(p_callsign text) returns text
language plpgsql immutable as $$
declare
  banned text[] := array['admin', 'moderator', 'fuck', 'shit', 'nigg', 'fag', 'cunt', 'rape', 'nazi'];
  word text;
begin
  if p_callsign is null or p_callsign !~ '^[A-Za-z0-9_.-]{2,12}$' then
    raise exception 'callsign_format' using errcode = 'P0001';
  end if;
  foreach word in array banned loop
    if position(word in lower(p_callsign)) > 0 then
      raise exception 'callsign_banned' using errcode = 'P0001';
    end if;
  end loop;
  return p_callsign;
end;
$$;

create or replace function public.dr_auth(p_player uuid, p_secret text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from players where id = p_player and secret_hash = dr_hash(p_secret)) then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.dr_region(p_region text) returns text
language sql immutable as $$
  select case when upper(p_region) ~ '^[A-Z]{2}$' then upper(p_region) end
$$;

-- ---------- player ----------

-- Creates a player. If the callsign is taken, tries it with a two-digit suffix.
create or replace function public.register_player(p_callsign text, p_region text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  -- Two v4 UUIDs: ~244 bits from the server's strong random source.
  v_secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_name text := dr_check_callsign(p_callsign);
  v_try text := v_name;
  v_id uuid;
begin
  for i in 1..20 loop
    begin
      insert into players (secret_hash, callsign, region)
      values (dr_hash(v_secret), v_try, dr_region(p_region))
      returning id into v_id;
      return json_build_object('id', v_id, 'secret', v_secret, 'callsign', v_try);
    exception when unique_violation then
      v_try := left(v_name, 10) || lpad((floor(random() * 100))::int::text, 2, '0');
    end;
  end loop;
  raise exception 'callsign_taken' using errcode = 'P0001';
end;
$$;

create or replace function public.set_callsign(p_player uuid, p_secret text, p_callsign text)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  perform dr_auth(p_player, p_secret);
  perform dr_check_callsign(p_callsign);
  begin
    update players set callsign = p_callsign where id = p_player;
  exception when unique_violation then
    raise exception 'callsign_taken' using errcode = 'P0001';
  end;
  return p_callsign;
end;
$$;

create or replace function public.set_region(p_player uuid, p_secret text, p_region text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform dr_auth(p_player, p_secret);
  update players set region = dr_region(p_region) where id = p_player;
end;
$$;

-- ---------- runs ----------

-- Issued when a run begins; the server clock it records is what submit_run checks against.
create or replace function public.start_run(p_player uuid, p_secret text, p_seed bigint)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform dr_auth(p_player, p_secret);
  delete from runs where player_id = p_player and submitted_at is null and started_at < now() - interval '1 day';
  if (select count(*) from runs where player_id = p_player and started_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into runs (player_id, seed) values (p_player, p_seed) returning id into v_id;
  return v_id;
end;
$$;

-- Rank of a player's best value among all players' bests (1 = top).
create or replace function public.dr_rank(p_player uuid, p_metric text, p_since timestamptz, p_region text)
returns json language sql stable security definer set search_path = public as $$
  with best as (
    select r.player_id, p.callsign,
           max(case when p_metric = 'distance' then r.distance else r.score end) as value
    from runs r join players p on p.id = r.player_id
    where r.submitted_at is not null
      and (p_since is null or r.submitted_at >= p_since)
      and (p_region is null or p.region = p_region)
    group by r.player_id, p.callsign
  ), me as (
    select value from best where player_id = p_player
  ), ahead as (
    select b.callsign, b.value, (select count(*) from best x where x.value > b.value) + 1 as rank
    from best b, me
    where b.value > me.value
    order by b.value asc
    limit 1
  )
  select json_build_object(
    'rank', (select count(*) + 1 from best, me where best.value > me.value),
    'value', (select value from me),
    'total', (select count(*) from best),
    'ahead', (select json_build_object('rank', rank, 'callsign', callsign, 'value', value) from ahead)
  )
  where exists (select 1 from me)
$$;

-- Validates and records a finished run. The bounds are generous: they stop impossible numbers,
-- not good players. 215 m/s is above the fastest possible speed (Ludicrous + boost at max pace).
create or replace function public.submit_run(
  p_player uuid, p_secret text, p_run uuid,
  p_distance integer, p_score integer, p_duration real, p_max_streak integer
) returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_run runs%rowtype;
  v_elapsed real;
begin
  perform dr_auth(p_player, p_secret);
  select * into v_run from runs where id = p_run and player_id = p_player for update;
  if not found or v_run.submitted_at is not null then
    raise exception 'run_invalid' using errcode = 'P0001';
  end if;
  v_elapsed := extract(epoch from now() - v_run.started_at);
  if v_elapsed > 3 * 3600
     or p_duration is null or p_duration < 0 or p_duration > v_elapsed + 5
     or p_distance is null or p_distance < 0 or p_distance > p_duration * 215 + 50
     or p_score is null or p_score < 0 or p_score > p_distance * 3 + p_duration * 3000 + 1000
     or p_max_streak is null or p_max_streak < 0 or p_max_streak > 50 then
    raise exception 'run_rejected' using errcode = 'P0001';
  end if;
  update runs
     set submitted_at = now(), distance = p_distance, score = p_score,
         duration = p_duration, max_streak = p_max_streak
   where id = p_run;
  return dr_rank(p_player, 'score', null, null);
end;
$$;

-- ---------- reading ----------

-- Top 100 players (each player's best run), plus the caller's own rank if they have one.
create or replace function public.get_leaderboard(
  p_metric text, p_period text, p_region text, p_player uuid
) returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_since timestamptz := case when p_period = 'weekly' then date_trunc('week', now()) end;
  v_region text := dr_region(p_region);
  v_rows json;
begin
  if p_metric not in ('score', 'distance') or p_period not in ('all', 'weekly') then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  with best as (
    select distinct on (r.player_id)
           r.player_id, p.callsign, p.region, r.score, r.distance, r.submitted_at
    from runs r join players p on p.id = r.player_id
    where r.submitted_at is not null
      and (v_since is null or r.submitted_at >= v_since)
      and (v_region is null or p.region = v_region)
    order by r.player_id,
             case when p_metric = 'distance' then r.distance else r.score end desc,
             r.submitted_at
  ), ranked as (
    select rank() over (order by case when p_metric = 'distance' then distance else score end desc) as rank,
           callsign, region, score, distance, player_id = p_player as me
    from best
  )
  select coalesce(json_agg(ranked order by rank, callsign), '[]'::json) into v_rows
  from (select * from ranked order by rank, callsign limit 100) ranked;

  return json_build_object(
    'rows', v_rows,
    'me', case when p_player is null then null else dr_rank(p_player, p_metric, v_since, v_region) end
  );
end;
$$;

-- ---------- permissions ----------

revoke all on function
  public.dr_hash(text), public.dr_check_callsign(text), public.dr_auth(uuid, text), public.dr_region(text),
  public.dr_rank(uuid, text, timestamptz, text),
  public.register_player(text, text), public.set_callsign(uuid, text, text), public.set_region(uuid, text, text),
  public.start_run(uuid, text, bigint),
  public.submit_run(uuid, text, uuid, integer, integer, real, integer),
  public.get_leaderboard(text, text, text, uuid)
from public;

grant execute on function
  public.register_player(text, text), public.set_callsign(uuid, text, text), public.set_region(uuid, text, text),
  public.start_run(uuid, text, bigint),
  public.submit_run(uuid, text, uuid, integer, integer, real, integer),
  public.get_leaderboard(text, text, text, uuid)
to anon, authenticated;
