-- Phase G keeps the initiating assistant message compatible while allowing
-- one durable, attributable checkpoint for each specialized agent. These
-- rows remain workspace-readable, so private draft/review artifact content
-- must never be referenced from them.
DROP INDEX IF EXISTS public.messages_run_role_unique;

CREATE UNIQUE INDEX messages_initiating_assistant_run_unique
  ON public.messages (org_id, run_id)
  WHERE run_id IS NOT NULL
    AND role = 'assistant'
    AND sender_agent IS NULL;

CREATE UNIQUE INDEX messages_run_sender_agent_unique
  ON public.messages (org_id, run_id, sender_agent)
  WHERE run_id IS NOT NULL
    AND sender_agent IS NOT NULL;
