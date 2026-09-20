-- Durable, workspace-shared Agent Chat metadata. Canonical analytics stay in runs/artifacts.
ALTER TABLE public.conversations
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'interactive',
  ADD COLUMN title TEXT NOT NULL DEFAULT 'New analysis',
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('interactive', 'scheduled')),
  ADD CONSTRAINT conversations_title_length_check CHECK (char_length(title) BETWEEN 1 AND 80);

ALTER TABLE public.messages
  ALTER COLUMN run_id DROP NOT NULL,
  ADD COLUMN client_turn_id TEXT,
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant')),
  ADD CONSTRAINT messages_status_check CHECK (status IN ('submitted', 'in_progress', 'completed', 'failed', 'cancelled'));

CREATE INDEX conversations_interactive_updated
  ON public.conversations (org_id, kind, updated_at DESC, id DESC);
CREATE INDEX messages_conversation_page
  ON public.messages (org_id, conversation_id, created_at, id);
CREATE UNIQUE INDEX messages_turn_role_unique
  ON public.messages (org_id, conversation_id, client_turn_id, role)
  WHERE client_turn_id IS NOT NULL;
CREATE UNIQUE INDEX messages_run_role_unique
  ON public.messages (org_id, run_id, role)
  WHERE run_id IS NOT NULL;

-- Chat remains BFF/repository write-only. Current workspace SELECT policy remains unchanged.
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
