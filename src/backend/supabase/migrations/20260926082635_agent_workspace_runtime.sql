-- Additive thread state; reports and artifacts retain their immutable identities.
ALTER TABLE public.conversations ADD COLUMN context JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 16384);
ALTER TABLE public.runs ADD COLUMN runtime_sequence INTEGER NOT NULL DEFAULT 0 CHECK (runtime_sequence >= 0);

CREATE TABLE public.runtime_activities (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  conversation_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('invocation','message','tool')),
  step_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 32768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id), UNIQUE (org_id,run_id,id), UNIQUE (org_id,run_id,kind,step_key),
  CHECK (payload->>'org_id'=org_id AND payload->>'activity_id'=id AND payload->>'run_id'=run_id AND payload->>'kind'=kind AND payload->>'step_key'=step_key AND payload->>'status'=status),
  FOREIGN KEY (org_id,run_id) REFERENCES public.runs(org_id,id),
  FOREIGN KEY (org_id,conversation_id) REFERENCES public.conversations(org_id,id)
);
CREATE INDEX runtime_activities_thread ON public.runtime_activities(org_id,conversation_id,created_at,id);
CREATE TABLE public.runtime_activity_events (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 32768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id), UNIQUE (org_id,run_id,sequence),
  FOREIGN KEY (org_id,run_id) REFERENCES public.runs(org_id,id),
  FOREIGN KEY (org_id,run_id,activity_id) REFERENCES public.runtime_activities(org_id,run_id,id),
  CHECK (payload->>'event_id'=id AND payload->>'run_id'=run_id AND (payload->>'sequence')::integer=sequence)
);
CREATE INDEX runtime_activity_events_activity ON public.runtime_activity_events(org_id,activity_id);
CREATE TRIGGER immutable_runtime_activity_events BEFORE UPDATE OR DELETE ON public.runtime_activity_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_change();

CREATE TABLE public.agent_memory (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  id TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('working','episodic','workspace')),
  conversation_id TEXT,
  run_id TEXT,
  scope_key TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  artifact_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifact_refs) = 'array' AND jsonb_array_length(artifact_refs) <= 24),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id), UNIQUE (org_id,layer,scope_key,memory_key),
  FOREIGN KEY (org_id,conversation_id) REFERENCES public.conversations(org_id,id),
  FOREIGN KEY (org_id,run_id) REFERENCES public.runs(org_id,id),
  CHECK ((layer='working' AND run_id IS NOT NULL AND scope_key=run_id) OR
    (layer='episodic' AND conversation_id IS NOT NULL AND scope_key=conversation_id) OR
    (layer='workspace' AND conversation_id IS NULL AND run_id IS NULL AND scope_key='workspace'))
);
CREATE INDEX agent_memory_thread ON public.agent_memory(org_id,conversation_id,updated_at DESC);
CREATE INDEX agent_memory_run ON public.agent_memory(org_id,run_id);
CREATE INDEX agent_memory_retrieval ON public.agent_memory USING gin(to_tsvector('simple',summary));

CREATE TABLE public.report_versions (
  org_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  parent_report_id TEXT,
  conversation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,report_id), UNIQUE (org_id,lineage_id,version),
  FOREIGN KEY (org_id,report_id) REFERENCES public.reports(org_id,id),
  FOREIGN KEY (org_id,lineage_id) REFERENCES public.reports(org_id,id),
  FOREIGN KEY (org_id,parent_report_id) REFERENCES public.reports(org_id,id),
  FOREIGN KEY (org_id,conversation_id) REFERENCES public.conversations(org_id,id),
  CHECK ((version=1 AND parent_report_id IS NULL AND report_id=lineage_id) OR (version>1 AND parent_report_id IS NOT NULL))
);
CREATE INDEX report_versions_thread ON public.report_versions(org_id,conversation_id,created_at DESC);
CREATE INDEX report_versions_parent ON public.report_versions(org_id,parent_report_id);
CREATE TRIGGER immutable_report_versions BEFORE UPDATE OR DELETE ON public.report_versions
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_change();

ALTER TABLE public.runtime_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runtime_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.runtime_activities,public.runtime_activity_events,public.agent_memory,public.report_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.runtime_activities,public.runtime_activity_events,public.agent_memory,public.report_versions TO authenticated;
GRANT ALL ON public.runtime_activities,public.runtime_activity_events,public.agent_memory,public.report_versions TO service_role;
CREATE POLICY workspace_read ON public.runtime_activities FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id=runtime_activities.org_id AND m.user_id=(SELECT auth.uid())::text)
);
CREATE POLICY workspace_read ON public.runtime_activity_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id=runtime_activity_events.org_id AND m.user_id=(SELECT auth.uid())::text)
);
-- Memories can contain private intermediate analysis: owner/analyst access only.
CREATE POLICY workspace_read ON public.agent_memory FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id=agent_memory.org_id AND m.user_id=(SELECT auth.uid())::text AND m.role IN ('owner','analyst'))
);
CREATE POLICY workspace_read ON public.report_versions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id=report_versions.org_id AND m.user_id=(SELECT auth.uid())::text)
);
