-- The chat turn, internal invocations, and AnalysisRun stages have separate identities.
ALTER TABLE public.messages ADD CONSTRAINT messages_org_conversation_id_unique UNIQUE (org_id,conversation_id,id);
CREATE TABLE public.agent_turn_jobs (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
  run_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  error_code TEXT CHECK (error_code ~ '^[A-Z0-9_]{1,100}$'),
  event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (event_sequence >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,user_message_id),
  UNIQUE (org_id,assistant_message_id),
  FOREIGN KEY (org_id,conversation_id) REFERENCES public.conversations(org_id,id),
  FOREIGN KEY (org_id,conversation_id,user_message_id) REFERENCES public.messages(org_id,conversation_id,id),
  FOREIGN KEY (org_id,conversation_id,assistant_message_id) REFERENCES public.messages(org_id,conversation_id,id),
  FOREIGN KEY (org_id,run_id) REFERENCES public.runs(org_id,id),
  CHECK ((status = 'running') = (worker_id IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX agent_turn_jobs_claim ON public.agent_turn_jobs(status,lease_until,created_at,id);
CREATE INDEX agent_turn_jobs_conversation ON public.agent_turn_jobs(org_id,conversation_id,created_at,id);
CREATE INDEX agent_turn_jobs_run ON public.agent_turn_jobs(org_id,run_id) WHERE run_id IS NOT NULL;

CREATE TABLE public.agent_invocations (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  parent_id TEXT,
  step_key TEXT NOT NULL CHECK (step_key ~ '^[a-z0-9][a-z0-9:._-]{0,119}$'),
  agent_key TEXT NOT NULL CHECK (agent_key ~ '^[a-z][a-z0-9_-]{0,79}$'),
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 16),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
  run_id TEXT,
  analysis_stage_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,job_id,id),
  UNIQUE (org_id,job_id,step_key),
  FOREIGN KEY (org_id,job_id) REFERENCES public.agent_turn_jobs(org_id,id),
  FOREIGN KEY (org_id,job_id,parent_id) REFERENCES public.agent_invocations(org_id,job_id,id),
  FOREIGN KEY (org_id,run_id) REFERENCES public.runs(org_id,id),
  FOREIGN KEY (org_id,run_id,analysis_stage_id) REFERENCES public.tasks(org_id,run_id,id),
  CHECK ((parent_id IS NULL) = (depth = 0)),
  CHECK (analysis_stage_id IS NULL OR run_id IS NOT NULL)
);
CREATE INDEX agent_invocations_parent ON public.agent_invocations(org_id,job_id,parent_id);
CREATE UNIQUE INDEX agent_invocations_one_root ON public.agent_invocations(org_id,job_id) WHERE parent_id IS NULL;
CREATE INDEX agent_invocations_stage ON public.agent_invocations(org_id,run_id,analysis_stage_id) WHERE analysis_stage_id IS NOT NULL;

CREATE TABLE public.agent_execution_events (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  invocation_id TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL CHECK (type IN ('turn_queued','turn_claimed','turn_waiting','turn_completed','turn_failed','turn_cancelled','run_linked','invocation_queued','invocation_started','invocation_waiting','invocation_completed','invocation_failed','invocation_cancelled')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(data) = 'object'
    AND octet_length(data::text) <= 1024
    AND (data - 'run_id' - 'artifact_id' - 'error_code') = '{}'::jsonb
    AND (NOT data ? 'error_code' OR data->>'error_code' ~ '^[A-Z0-9_]{1,100}$')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,job_id,sequence),
  FOREIGN KEY (org_id,job_id) REFERENCES public.agent_turn_jobs(org_id,id),
  FOREIGN KEY (org_id,job_id,invocation_id) REFERENCES public.agent_invocations(org_id,job_id,id)
);
CREATE INDEX agent_execution_events_invocation ON public.agent_execution_events(org_id,job_id,invocation_id,sequence);
CREATE TRIGGER immutable_agent_execution_events BEFORE UPDATE OR DELETE ON public.agent_execution_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_change();

ALTER TABLE public.agent_turn_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_execution_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_turn_jobs,public.agent_invocations,public.agent_execution_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.agent_turn_jobs,public.agent_invocations,public.agent_execution_events TO authenticated;
GRANT ALL ON public.agent_turn_jobs,public.agent_invocations,public.agent_execution_events TO service_role;
CREATE POLICY workspace_read ON public.agent_turn_jobs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id=agent_turn_jobs.org_id AND m.user_id=(SELECT auth.uid())::text)
);
CREATE POLICY workspace_read ON public.agent_invocations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id=agent_invocations.org_id AND m.user_id=(SELECT auth.uid())::text)
);
CREATE POLICY workspace_read ON public.agent_execution_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id=agent_execution_events.org_id AND m.user_id=(SELECT auth.uid())::text)
);
