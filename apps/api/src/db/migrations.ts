import type { PGliteStore } from './pglite-store.js';

const SETUP_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- Baseline schema privileges. Re-applied on every startup so DBs created
-- before these grants existed get repaired idempotently.
GRANT USAGE ON SCHEMA auth       TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public     TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public    TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'authenticated',
  email_confirmed   BOOLEAN NOT NULL DEFAULT false,
  is_disabled       BOOLEAN NOT NULL DEFAULT false,
  metadata          JSONB,
  last_sign_in_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  family_id           UUID NOT NULL,
  ip_address          TEXT,
  user_agent          TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx   ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON auth.sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON auth.sessions(expires_at);

-- Table-level grants for auth.* — idempotent, re-applied on every startup.
GRANT SELECT                      ON auth.users    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users    TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.sessions TO service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
    )::uuid
  $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
      'anon'
    )
  $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.email', true), ''),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'email'
    )
  $$;

-- Install real extensions so stub functions below can use them (e.g. hmac from pgcrypto).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ── pgjwt ──────────────────────────────────────────────────────────────────
-- Real SQL implementation using pgcrypto. Produces identical output to the
-- pgjwt C extension. CREATE EXTENSION pgjwt is stripped by the preprocessor.

CREATE OR REPLACE FUNCTION extensions.url_encode(data bytea) RETURNS text
  LANGUAGE sql AS $$
    SELECT translate(encode(data, 'base64'), E'+/=\n', '-_');
  $$;

CREATE OR REPLACE FUNCTION extensions.url_decode(data text) RETURNS bytea
  LANGUAGE sql AS $$
    WITH t AS (SELECT translate(data, '-_', '+/') AS v),
         r AS (SELECT length(t.v) % 4 AS n FROM t)
    SELECT decode(
      t.v || CASE r.n WHEN 0 THEN '' WHEN 1 THEN '===' WHEN 2 THEN '==' ELSE '=' END,
      'base64'
    ) FROM t, r;
  $$;

CREATE OR REPLACE FUNCTION extensions.algorithm_sign(signables text, secret text, algorithm text)
  RETURNS text LANGUAGE sql AS $$
    SELECT extensions.url_encode(hmac(
      signables, secret,
      CASE algorithm WHEN 'HS256' THEN 'sha256' WHEN 'HS384' THEN 'sha384' WHEN 'HS512' THEN 'sha512' END
    ));
  $$;

CREATE OR REPLACE FUNCTION extensions.sign(payload json, secret text, algorithm text DEFAULT 'HS256')
  RETURNS text LANGUAGE sql AS $$
    WITH
      h AS (SELECT extensions.url_encode(convert_to('{"alg":"' || algorithm || '","typ":"JWT"}', 'utf8')) AS v),
      p AS (SELECT extensions.url_encode(convert_to(payload::text, 'utf8')) AS v),
      s AS (SELECT h.v || '.' || p.v AS v FROM h, p)
    SELECT s.v || '.' || extensions.algorithm_sign(s.v, secret, algorithm) FROM s;
  $$;

CREATE OR REPLACE FUNCTION extensions.verify(token text, secret text, algorithm text DEFAULT 'HS256')
  RETURNS TABLE(header json, payload json, valid boolean) LANGUAGE sql AS $$
    WITH t AS (SELECT string_to_array(token, '.') AS p)
    SELECT
      convert_from(extensions.url_decode(t.p[1]), 'utf8')::json,
      convert_from(extensions.url_decode(t.p[2]), 'utf8')::json,
      t.p[3] = extensions.algorithm_sign(t.p[1] || '.' || t.p[2], secret, algorithm)
    FROM t;
  $$;

-- ── vault ──────────────────────────────────────────────────────────────────
-- Simplified: secrets stored as plaintext locally (no pgsodium encryption).
-- Same API as Supabase Vault. CREATE EXTENSION supabase_vault is stripped.

CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        UNIQUE,
  description text        NOT NULL DEFAULT '',
  secret      text        NOT NULL,
  key_id      uuid,
  nonce       bytea,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret,
         key_id, nonce, created_at, updated_at
  FROM vault.secrets;

-- ── pg_net ─────────────────────────────────────────────────────────────────
-- Stub: functions exist but raise a clear error. CREATE EXTENSION pg_net stripped.

CREATE SCHEMA IF NOT EXISTS net;

CREATE TABLE IF NOT EXISTS net._http_response (
  id           bigint,
  status_code  int,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'pg_net is not available in local mode — use application-level HTTP or Edge Functions instead';
  END;
  $$;

CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'pg_net is not available in local mode — use application-level HTTP or Edge Functions instead';
  END;
  $$;

CREATE OR REPLACE FUNCTION net.http_delete(url text, params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'pg_net is not available in local mode — use application-level HTTP or Edge Functions instead';
  END;
  $$;

-- ── pg_graphql ─────────────────────────────────────────────────────────────
-- Stub: raises clear error. CREATE EXTENSION pg_graphql stripped.

CREATE SCHEMA IF NOT EXISTS graphql;

CREATE OR REPLACE FUNCTION graphql.resolve(query text, variables jsonb DEFAULT '{}', "operationName" text DEFAULT NULL, extensions jsonb DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'pg_graphql is not available in local mode — use the REST API instead';
  END;
  $$;

-- ── pg_jsonschema ──────────────────────────────────────────────────────────
-- No-op stub: always returns true locally. CREATE EXTENSION pg_jsonschema stripped.

CREATE OR REPLACE FUNCTION extensions.jsonschema_is_valid(schema jsonb)
  RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION extensions.jsonb_matches_schema(schema jsonb, instance jsonb)
  RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION extensions.json_matches_schema(schema json, instance json)
  RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

-- ── pg_cron ────────────────────────────────────────────────────────────────
-- Schema + tables + functions. The Node.js bridge in server.ts polls cron.job
-- every minute and executes due commands. CREATE EXTENSION pg_cron stripped.

CREATE SCHEMA IF NOT EXISTS cron;

CREATE TABLE IF NOT EXISTS cron.job (
  jobid    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule text    NOT NULL,
  command  text    NOT NULL,
  nodename text    NOT NULL DEFAULT 'localhost',
  nodeport int     NOT NULL DEFAULT 5432,
  database text    NOT NULL DEFAULT current_database(),
  username text    NOT NULL DEFAULT current_user,
  active   boolean NOT NULL DEFAULT true,
  jobname  text
);

CREATE UNIQUE INDEX IF NOT EXISTS cron_job_jobname_idx ON cron.job (jobname)
  WHERE jobname IS NOT NULL;

CREATE TABLE IF NOT EXISTS cron.job_run_details (
  jobid          bigint,
  runid          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_pid        int,
  database       text,
  username       text,
  command        text,
  status         text,
  return_message text,
  start_time     timestamptz DEFAULT now(),
  end_time       timestamptz
);

CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
  RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid;
  $$;

CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
  RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
    RETURNING jobid;
  $$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
  RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING jobid)
    SELECT count(*) > 0 FROM d;
  $$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
  RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobid = job_id RETURNING jobid)
    SELECT count(*) > 0 FROM d;
  $$;

-- ── pgsodium ───────────────────────────────────────────────────────────────
-- Minimal stub delegating to pgcrypto where possible.
-- CREATE EXTENSION pgsodium stripped.

CREATE SCHEMA IF NOT EXISTS pgsodium;

CREATE OR REPLACE FUNCTION pgsodium.randombytes(size int)
  RETURNS bytea LANGUAGE sql AS $$ SELECT gen_random_bytes(size) $$;

CREATE OR REPLACE FUNCTION pgsodium.crypto_secretbox_keygen()
  RETURNS bytea LANGUAGE sql AS $$ SELECT gen_random_bytes(32) $$;

CREATE OR REPLACE FUNCTION pgsodium.crypto_secretbox_noncegen()
  RETURNS bytea LANGUAGE sql AS $$ SELECT gen_random_bytes(24) $$;

CREATE OR REPLACE FUNCTION pgsodium.crypto_secretbox(message bytea, nonce bytea, key bytea)
  RETURNS bytea LANGUAGE sql AS $$ SELECT encrypt_iv(message, key, nonce, 'aes-cbc') $$;

CREATE OR REPLACE FUNCTION pgsodium.crypto_secretbox_open(ciphertext bytea, nonce bytea, key bytea)
  RETURNS bytea LANGUAGE sql AS $$ SELECT decrypt_iv(ciphertext, key, nonce, 'aes-cbc') $$;

-- ── storage ────────────────────────────────────────────────────────────────
-- Mirrors the Supabase storage schema for client SDK compatibility.

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text        PRIMARY KEY,
  name               text        UNIQUE NOT NULL,
  owner              uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  public             boolean     NOT NULL DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        text        NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  owner            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_id         text,
  version          text        NOT NULL DEFAULT gen_random_uuid()::text,
  size             bigint,
  content_type     text,
  cache_control    text,
  etag             text,
  user_metadata    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name)
);

CREATE INDEX IF NOT EXISTS objects_bucket_id_name_idx ON storage.objects (bucket_id, name);

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE plpgsql STABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;

CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
  LANGUAGE plpgsql STABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[array_length(_parts, 1)];
END $$;

CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
  LANGUAGE plpgsql STABLE AS $$
DECLARE _filename text;
BEGIN
  SELECT storage.filename(name) INTO _filename;
  RETURN reverse(split_part(reverse(_filename), '.', 1));
END $$;

-- ── job queue ──────────────────────────────────────────────────────────────
-- Generic job queue that invokes any Edge Function or Node Function per job.
-- Rows are inserted via POST /tophbase/jobs (see plugins/tophbase); an
-- AFTER INSERT trigger does pg_notify so the Node.js worker in server.ts can
-- dequeue immediately instead of polling.

CREATE TABLE IF NOT EXISTS public.jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text        NOT NULL,
  runtime       text        NOT NULL DEFAULT 'edge' CHECK (runtime IN ('edge', 'node')),
  payload       jsonb       NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts      int         NOT NULL DEFAULT 0,
  error         text,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON public.jobs (status, created_at);

CREATE OR REPLACE FUNCTION public.notify_jobs_queue() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('jobs_queue', NEW.id::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS jobs_notify ON public.jobs;
CREATE TRIGGER jobs_notify
  AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_jobs_queue();

-- service_role only: jobs are created via POST /tophbase/jobs (which validates
-- the target function exists) or server-side code using the secret key.
-- No grants to authenticated/anon — direct REST inserts would bypass that
-- validation and let any end user invoke arbitrary configured functions.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO service_role;
REVOKE ALL ON public.jobs FROM authenticated, anon;
`;

export async function runBootstrapMigrations(store: PGliteStore): Promise<void> {
  await store.exec(SETUP_SQL);
}

