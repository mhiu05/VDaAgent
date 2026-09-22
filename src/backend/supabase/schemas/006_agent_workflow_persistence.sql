-- Additive persistence for the versioned agent workflow. Existing artifact payloads
-- remain canonical and immutable; the relational key gives revisions a stable slot.
ALTER TABLE public.artifacts
  ADD COLUMN artifact_key TEXT NOT NULL;

-- `kind` remains a payload classification, not a per-run identity. Revisions
-- therefore share a kind while reserving distinct immutable artifact keys.
ALTER TABLE public.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_org_id_run_id_kind_key;

ALTER TABLE public.artifacts
  ADD CONSTRAINT artifacts_artifact_key_shape_check
    CHECK (
      artifact_key = btrim(artifact_key)
      AND char_length(artifact_key) BETWEEN 1 AND 160
    ),
  ADD CONSTRAINT artifacts_report_key_kind_check
    CHECK (
      artifact_key <> 'report' OR kind = 'report'
    ),
  ADD CONSTRAINT artifacts_org_run_artifact_key_unique
    UNIQUE (org_id, run_id, artifact_key);

-- Older writers know only `kind`. This trigger preserves that write path while
-- allowing new writers to reserve explicit revision keys such as report_draft:1.
CREATE OR REPLACE FUNCTION private.assign_legacy_artifact_key() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.artifact_key IS NULL OR char_length(btrim(NEW.artifact_key)) = 0 THEN
    NEW.artifact_key := NEW.kind;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.assign_legacy_artifact_key() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER artifacts_assign_legacy_key
  BEFORE INSERT ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION private.assign_legacy_artifact_key();

ALTER TABLE public.messages
  ADD COLUMN sender_agent TEXT,
  ADD CONSTRAINT messages_sender_agent_check CHECK (
    sender_agent IS NULL
    OR (
      role = 'assistant'
      AND sender_agent IN (
        'coordinator',
        'data',
        'comparison',
        'chart',
        'analyst',
        'insight',
        'report',
        'reviewer'
      )
    )
  );

-- The unique artifact constraint supplies the exact `(org_id, run_id,
-- artifact_key)` lookup index. This additional partial index supports bounded
-- attributed-stage pages without changing legacy conversation reads.
CREATE INDEX messages_run_sender_agent_page
  ON public.messages (org_id, run_id, sender_agent, created_at, id)
  WHERE run_id IS NOT NULL AND sender_agent IS NOT NULL;

-- These remain table-level controls so the additive columns do not make direct
-- authenticated writes possible. Existing workspace SELECT policies still scope
-- reads by organization membership.
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.artifacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.artifacts TO authenticated;
GRANT ALL ON public.artifacts TO service_role;
DROP POLICY IF EXISTS workspace_read ON public.artifacts;
CREATE POLICY workspace_read ON public.artifacts FOR SELECT TO authenticated USING (
  EXISTS(
    SELECT 1
    FROM public.organization_members m
    WHERE m.org_id=artifacts.org_id
      AND m.user_id=(SELECT auth.uid())::text
      AND (
        artifacts.kind NOT IN ('report_draft','review_result')
        OR m.role IN ('owner','analyst')
      )
  )
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

-- A public report must not reveal owner/analyst-only draft or review lineage
-- through companion tables. SECURITY DEFINER is intentional: evaluating the
-- private artifact kind through normal RLS would make a hidden row appear not
-- to exist and would accidentally allow the relationship row to be read.
CREATE OR REPLACE FUNCTION private.can_read_artifact_lineage(target_org TEXT,target_artifact TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.organization_members m
    WHERE m.org_id=target_org
      AND m.user_id=(SELECT auth.uid())::text
      AND (
        m.role IN ('owner','analyst')
        OR NOT EXISTS(
          SELECT 1
          FROM public.artifacts a
          WHERE a.org_id=target_org
            AND a.id=target_artifact
            AND a.kind IN ('report_draft','review_result')
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION private.can_read_artifact_lineage(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_artifact_lineage(TEXT,TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS workspace_read ON public.artifact_inputs;
CREATE POLICY workspace_read ON public.artifact_inputs FOR SELECT TO authenticated USING (
  private.can_read_artifact_lineage(artifact_inputs.org_id,artifact_inputs.artifact_id)
  AND private.can_read_artifact_lineage(artifact_inputs.org_id,artifact_inputs.input_id)
);
DROP POLICY IF EXISTS workspace_read ON public.artifact_snapshots;
CREATE POLICY workspace_read ON public.artifact_snapshots FOR SELECT TO authenticated USING (
  private.can_read_artifact_lineage(artifact_snapshots.org_id,artifact_snapshots.artifact_id)
);
DROP POLICY IF EXISTS workspace_read ON public.artifact_sources;
CREATE POLICY workspace_read ON public.artifact_sources FOR SELECT TO authenticated USING (
  private.can_read_artifact_lineage(artifact_sources.org_id,artifact_sources.artifact_id)
);
DROP POLICY IF EXISTS workspace_read ON public.validations;
CREATE POLICY workspace_read ON public.validations FOR SELECT TO authenticated USING (
  private.can_read_artifact_lineage(validations.org_id,validations.id)
);
