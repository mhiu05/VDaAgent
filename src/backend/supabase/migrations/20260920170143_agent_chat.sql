-- Generated filename via `supabase migration new agent_chat`.
-- Declarative sync is blocked by the pre-existing storage.buckets seed in 004;
-- this reviewed additive migration mirrors schemas/005_agent_chat.sql and adds
-- the data backfill that declarative schema diff intentionally cannot express.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE public.messages
  ALTER COLUMN run_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS client_turn_id TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.messages
SET
  role = CASE
    WHEN payload->>'role' IN ('user', 'assistant') THEN payload->>'role'
    ELSE 'user'
  END,
  status = CASE
    WHEN payload->>'status' IN ('submitted', 'in_progress', 'completed', 'failed', 'cancelled')
      THEN payload->>'status'
    ELSE 'completed'
  END,
  client_turn_id = NULLIF(payload->>'client_turn_id', ''),
  created_at = COALESCE(
    created_at,
    NULLIF(payload->>'created_at', '')::timestamptz,
    now()
  ),
  updated_at = COALESCE(
    updated_at,
    NULLIF(payload->>'updated_at', '')::timestamptz,
    NULLIF(payload->>'created_at', '')::timestamptz,
    now()
  );

UPDATE public.conversations c
SET
  kind = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.org_id = c.org_id
        AND r.payload #>> '{request,conversation_id}' = c.id
        AND r.payload->>'entrypoint' = 'scheduled'
    ) THEN 'scheduled'
    ELSE 'interactive'
  END,
  title = COALESCE(
    NULLIF(
      (
        SELECT left(regexp_replace(m.payload->>'content', '\s+', ' ', 'g'), 80)
        FROM public.messages m
        WHERE m.org_id = c.org_id
          AND m.conversation_id = c.id
          AND m.role = 'user'
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT 1
      ),
      ''
    ),
    'New analysis'
  ),
  created_at = COALESCE(
    created_at,
    (SELECT min(m.created_at) FROM public.messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id),
    now()
  ),
  updated_at = COALESCE(
    updated_at,
    (SELECT max(m.updated_at) FROM public.messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id),
    now()
  );

ALTER TABLE public.conversations
  ALTER COLUMN kind SET DEFAULT 'interactive',
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN title SET DEFAULT 'New analysis',
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.messages
  ALTER COLUMN role SET DEFAULT 'user',
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'completed',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_kind_check') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('interactive', 'scheduled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_title_length_check') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_title_length_check CHECK (char_length(title) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_role_check') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_status_check') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_status_check CHECK (status IN ('submitted', 'in_progress', 'completed', 'failed', 'cancelled'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS conversations_interactive_updated
  ON public.conversations (org_id, kind, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_page
  ON public.messages (org_id, conversation_id, created_at, id);
-- Historic direct-analysis retries can have duplicate user rows for one run.
-- Keep their immutable JSON payload (including the run reference) but reserve
-- the relational run_id for the deterministic canonical row before enforcing
-- the new one-message-per-role invariant.
WITH ranked_messages AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY org_id, run_id, role
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.messages
  WHERE run_id IS NOT NULL
)
UPDATE public.messages m
SET run_id = NULL
FROM ranked_messages ranked
WHERE m.ctid = ranked.ctid
  AND ranked.row_number > 1;
CREATE UNIQUE INDEX IF NOT EXISTS messages_turn_role_unique
  ON public.messages (org_id, conversation_id, client_turn_id, role)
  WHERE client_turn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_run_role_unique
  ON public.messages (org_id, run_id, role)
  WHERE run_id IS NOT NULL;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
