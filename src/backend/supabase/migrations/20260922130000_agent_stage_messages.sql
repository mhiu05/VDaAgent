-- Generated declarative intent: preserve the legacy terminal assistant row
-- while permitting one fenced, idempotent specialized-agent checkpoint per
-- run. Historical messages are neither rewritten nor deleted.
DROP INDEX IF EXISTS public.messages_run_role_unique;

CREATE UNIQUE INDEX IF NOT EXISTS messages_initiating_assistant_run_unique
  ON public.messages (org_id, run_id)
  WHERE run_id IS NOT NULL
    AND role = 'assistant'
    AND sender_agent IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_run_sender_agent_unique
  ON public.messages (org_id, run_id, sender_agent)
  WHERE run_id IS NOT NULL
    AND sender_agent IS NOT NULL;
