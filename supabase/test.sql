-- Functional tests for schema.sql. Run against a SCRATCH database only (it rewrites run start
-- times as superuser to simulate elapsed play):
--   psql -h <host> -U postgres -f supabase/schema.sql && psql -h <host> -U postgres -f supabase/test.sql
-- A fresh database needs the anon/authenticated roles first (Supabase already has them):
--   create role anon nologin; create role authenticated nologin; grant usage on schema public to anon, authenticated;

\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
set role anon;
\echo '--- 1. direct table access (expect permission denied)'
select count(*) from players;
\echo '--- 2. register'
select r->>'id' as a_id, r->>'secret' as a_sec, r->>'callsign' as a_name from register_player('TurboFox', 'ng') r \gset
select r->>'id' as b_id, r->>'secret' as b_sec, r->>'callsign' as b_name from register_player('TurboFox', 'GB') r \gset
\echo A=:a_name B=:b_name
\echo '--- 3. callsign rules (expect unauthorized, callsign_format, callsign_banned, callsign_taken, then ok)'
select set_callsign(:'b_id', 'wrong', 'NewName');
select set_callsign(:'b_id', :'b_sec', 'x');
select set_callsign(:'b_id', :'b_sec', 'xAdminx');
select set_callsign(:'b_id', :'b_sec', 'turbofox');
select set_callsign(:'b_id', :'b_sec', 'NeonViper');
\echo '--- 4. submit too early (expect run_rejected)'
select start_run(:'a_id', :'a_sec', 42) as a_run \gset
select submit_run(:'a_id', :'a_sec', :'a_run', 2000, 3000, 55, 4);
reset role;
update runs set started_at = now() - interval '60 seconds';
set role anon;
\echo '--- 5. valid submit (expect rank 1)'
select submit_run(:'a_id', :'a_sec', :'a_run', 2000, 3000, 55, 4);
\echo '--- 6. resubmit same run (expect run_invalid)'
select submit_run(:'a_id', :'a_sec', :'a_run', 2000, 3000, 55, 4);
\echo '--- 7. impossible distance / score / streak (expect run_rejected x3)'
select start_run(:'a_id', :'a_sec', 1) as r2 \gset
reset role; update runs set started_at = now() - interval '60 seconds' where id = :'r2'; set role anon;
select submit_run(:'a_id', :'a_sec', :'r2', 50000, 1000, 10, 1);
select submit_run(:'a_id', :'a_sec', :'r2', 1000, 999999999, 10, 1);
select submit_run(:'a_id', :'a_sec', :'r2', 1000, 1000, 10, 99);
\echo '--- 8. using another player run id (expect run_invalid)'
select submit_run(:'b_id', :'b_sec', :'r2', 100, 100, 10, 1);
\echo '--- 9. B beats A (expect B rank 1; then A rank 2 with ahead = NeonViper)'
select start_run(:'b_id', :'b_sec', 2) as b_run \gset
reset role; update runs set started_at = now() - interval '120 seconds' where id = :'b_run'; set role anon;
select submit_run(:'b_id', :'b_sec', :'b_run', 1500, 9000, 100, 9);
select get_leaderboard('score', 'all', null, :'a_id');
\echo '--- 10. by distance, weekly (A first: 2000 m > 1500 m)'
select get_leaderboard('distance', 'weekly', null, :'b_id');
\echo '--- 11. region NG only (A only)'
select get_leaderboard('score', 'all', 'ng', :'a_id');
\echo '--- 12. bad metric (expect bad_request)'
select get_leaderboard('speed', 'all', null, null);
