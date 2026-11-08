-- V1 final stabilization: Phase 9 roadmap item "Limiter les tentatives de
-- connexion" was still open. Supabase Auth itself has no configurable
-- per-account/per-IP lockout in this self-hosted setup, and the existing
-- login route (src/app/auth/login/route.ts) called signInWithPassword with
-- no attempt tracking at all - unlimited online guessing was possible
-- against any known or guessed email.
--
-- Deliberately NOT a PostgREST-exposed RPC: this table has no RLS policies
-- and no GRANT to anon/authenticated at all. It is only ever read/written
-- server-side, from the login route, using the existing service-role admin
-- client (src/lib/supabase/admin.ts) - the same trust boundary already used
-- for user administration. No new infrastructure (Redis, a reverse-proxy
-- rate limiter, etc.) is introduced; this is deliberately the smallest V1
-- mechanism that does not depend on anything the project does not already
-- have. A reverse-proxy/deployment-layer layer of protection is documented
-- separately (docs/DEPLOYMENT_GUIDE.md) as a complementary, not alternative,
-- control - this table is the application-level guarantee that holds even
-- when BreedOps is reached directly.
CREATE TABLE public.auth_rate_limits (
  scope TEXT NOT NULL CHECK (scope IN ('login_email', 'login_ip')),
  key TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 320),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, key)
);
COMMENT ON TABLE public.auth_rate_limits IS
  'Server-side-only login attempt tracking (no RLS policies, no client grants - accessed exclusively via the service-role admin client from the login route). Two independent scopes: per-email and per-IP, so a targeted victim cannot be locked out by someone else failing a different email from the same address space, and a single IP cannot brute-force many accounts by staying under the per-email threshold.';

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: with RLS enabled and zero policies, every role except the
-- table owner / service-role (which bypasses RLS entirely) is denied by
-- default - this table is reachable only through the service-role client.

-- Returns the number of seconds remaining before this (scope, key) may try
-- again; 0 if not currently locked. Read-only, safe to call before
-- attempting authentication so a locked-out request never even reaches
-- Supabase Auth.
CREATE FUNCTION public.auth_rate_limit_check(p_scope TEXT, p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - NOW())))::INTEGER)
  FROM auth_rate_limits
  WHERE scope = p_scope AND key = p_key AND locked_until IS NOT NULL AND locked_until > NOW();
$$;
REVOKE ALL ON FUNCTION public.auth_rate_limit_check(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Records one login outcome and returns the resulting lockout (seconds
-- remaining, 0 if still unlocked). A success clears the row entirely -
-- correct password use is never penalized by earlier mistakes. A failure
-- increments the counter; from the 5th consecutive failure onward, each
-- further failure extends an exponentially-growing lockout
-- (30s, 60s, 120s, 240s, 480s, capped at 900s/15min) rather than a single
-- fixed window, so sustained guessing gets progressively more expensive
-- without ever permanently locking a real user out.
CREATE FUNCTION public.auth_rate_limit_record(p_scope TEXT, p_key TEXT, p_success BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_failed_count INTEGER;
  v_locked_until TIMESTAMPTZ;
BEGIN
  IF p_success THEN
    DELETE FROM auth_rate_limits WHERE scope = p_scope AND key = p_key;
    RETURN 0;
  END IF;

  INSERT INTO auth_rate_limits(scope, key, failed_count, updated_at)
  VALUES (p_scope, p_key, 1, NOW())
  ON CONFLICT (scope, key) DO UPDATE
    SET failed_count = auth_rate_limits.failed_count + 1, updated_at = NOW()
  RETURNING failed_count INTO v_failed_count;

  IF v_failed_count >= 5 THEN
    v_locked_until := NOW() + (LEAST(900, 30 * POWER(2, v_failed_count - 5)) * INTERVAL '1 second');
    UPDATE auth_rate_limits SET locked_until = v_locked_until
    WHERE scope = p_scope AND key = p_key;
    RETURN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_locked_until - NOW())))::INTEGER);
  END IF;
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION public.auth_rate_limit_record(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
