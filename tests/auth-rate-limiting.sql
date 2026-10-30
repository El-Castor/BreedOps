-- Disposable local test fixtures only. Everything is rolled back.
-- Covers migration 000023: server-side login attempt rate limiting
-- (auth_rate_limit_check / auth_rate_limit_record). These functions are
-- never exposed via RLS/PostgREST grants (REVOKE ALL FROM PUBLIC, anon,
-- authenticated) - called only from the login route's service-role admin
-- client - so these tests run as the table owner, matching that trust
-- boundary, rather than under SET LOCAL ROLE authenticated.
--
-- auth_rate_limit_record is intentionally volatile (it mutates
-- auth_rate_limits). pgTap's results_eq(text, anyarray) can evaluate its
-- "have" query more than once internally while building its symmetric
-- diff/diagnostic - confirmed empirically here (a single results_eq(sql
-- wrapping the live call, ...) advanced failed_count by 2, not 1). Every
-- mutating call is therefore captured exactly once via a plain `SELECT
-- INTO TEMP` first, and assertions run only against that already-
-- materialized value - never by re-embedding the live call inside a
-- pgtap comparison function's own SQL text.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

SELECT results_eq($$
  SELECT auth_rate_limit_check('login_email', 'fresh@example.test')
$$, ARRAY[NULL::int], 'a key with no recorded attempts is not locked');

SELECT auth_rate_limit_record('login_email', 'victim@example.test', false) AS seconds INTO TEMP step1;
SELECT results_eq($$ SELECT seconds FROM step1 $$, ARRAY[0], '1st failure does not lock');
SELECT auth_rate_limit_record('login_email', 'victim@example.test', false) AS seconds INTO TEMP step2;
SELECT results_eq($$ SELECT seconds FROM step2 $$, ARRAY[0], '2nd failure does not lock');
SELECT auth_rate_limit_record('login_email', 'victim@example.test', false) AS seconds INTO TEMP step3;
SELECT results_eq($$ SELECT seconds FROM step3 $$, ARRAY[0], '3rd failure does not lock');
SELECT auth_rate_limit_record('login_email', 'victim@example.test', false) AS seconds INTO TEMP step4;
SELECT results_eq($$ SELECT seconds FROM step4 $$, ARRAY[0], '4th failure does not lock');
SELECT auth_rate_limit_record('login_email', 'victim@example.test', false) AS seconds INTO TEMP step5;
SELECT results_eq($$ SELECT seconds BETWEEN 25 AND 30 FROM step5 $$, ARRAY[true],
  '5th consecutive failure locks for ~30 seconds');
SELECT results_eq($$
  SELECT auth_rate_limit_check('login_email', 'victim@example.test') BETWEEN 25 AND 30
$$, ARRAY[true], 'the lock is independently visible via the check function');

SELECT auth_rate_limit_record('login_email', 'victim@example.test', false) AS seconds INTO TEMP step6;
SELECT results_eq($$ SELECT seconds BETWEEN 55 AND 60 FROM step6 $$, ARRAY[true],
  '6th failure extends the lockout further (exponential backoff, not a fixed window)');

-- A successful attempt clears the lockout entirely, regardless of how many
-- failures preceded it - a correct password is never penalized by earlier
-- mistakes once it succeeds.
SELECT auth_rate_limit_record('login_email', 'victim@example.test', true) AS seconds INTO TEMP step7;
SELECT results_eq($$ SELECT seconds FROM step7 $$, ARRAY[0], 'a success clears the lockout');
SELECT results_eq($$
  SELECT auth_rate_limit_check('login_email', 'victim@example.test')
$$, ARRAY[NULL::int], 'the key is unlocked immediately after a success');

-- The two scopes (per-email, per-IP) are independent key spaces: failing
-- the same string under 'login_ip' never touches the 'login_email' lock
-- for that same string, and vice versa.
SELECT auth_rate_limit_record('login_ip', '203.0.113.9', false) AS seconds INTO TEMP step8;
SELECT results_eq($$ SELECT seconds FROM step8 $$, ARRAY[0], 'login_ip scope accepts its own independent key');
SELECT results_eq($$
  SELECT auth_rate_limit_check('login_email', '203.0.113.9')
$$, ARRAY[NULL::int], 'a failure recorded under login_ip never locks the same string under login_email');

-- A targeted victim's email lock does not affect an unrelated email -
-- repeatedly failing one account can never lock out a different one.
INSERT INTO auth_rate_limits(scope, key, failed_count, locked_until) VALUES
  ('login_email', 'attacker-target@example.test', 10, NOW() + INTERVAL '15 minutes');
SELECT results_eq($$
  SELECT auth_rate_limit_check('login_email', 'someone-else@example.test')
$$, ARRAY[NULL::int], 'one email''s lockout never affects a different email');

-- The lockout is capped, not unbounded: once failures climb well past the
-- threshold, the lock never exceeds the documented 900-second (15 minute) cap.
SELECT results_eq($$
  SELECT auth_rate_limit_check('login_email', 'attacker-target@example.test') <= 900
$$, ARRAY[true], 'the lockout duration is capped at 15 minutes, never unbounded');

SELECT throws_ok($$
  SELECT auth_rate_limit_record('not_a_real_scope', 'x@y.test', false)
$$, '23514', null, 'an undefined scope value is rejected by the CHECK constraint');

SELECT * FROM finish();
ROLLBACK;
