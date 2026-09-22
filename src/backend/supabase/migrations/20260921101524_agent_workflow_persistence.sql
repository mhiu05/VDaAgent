-- Generated with `supabase migration new agent_workflow_persistence`.
-- This is additive and leaves historical payload JSON and content hashes intact.
ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS artifact_key TEXT;

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
DROP TRIGGER IF EXISTS artifacts_assign_legacy_key ON public.artifacts;
CREATE TRIGGER artifacts_assign_legacy_key
  BEFORE INSERT ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION private.assign_legacy_artifact_key();

-- The pre-existing immutable trigger intentionally rejects UPDATEs. The
-- trigger swap and backfill share a PL/pgSQL exception subtransaction: an
-- unexpected failure rolls back the swap, so immutability is never left off.
DO $$
BEGIN
  DROP TRIGGER IF EXISTS immutable_artifacts ON public.artifacts;
  UPDATE public.artifacts
  SET artifact_key = kind
  WHERE artifact_key IS NULL OR char_length(btrim(artifact_key)) = 0;
  CREATE TRIGGER immutable_artifacts
    BEFORE UPDATE OR DELETE ON public.artifacts
    FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_change();
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

ALTER TABLE public.artifacts
  ALTER COLUMN artifact_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.artifacts'::regclass
      AND conname = 'artifacts_artifact_key_shape_check'
  ) THEN
    ALTER TABLE public.artifacts
      ADD CONSTRAINT artifacts_artifact_key_shape_check
      CHECK (
        artifact_key = btrim(artifact_key)
        AND char_length(artifact_key) BETWEEN 1 AND 160
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.artifacts'::regclass
      AND conname = 'artifacts_report_key_kind_check'
  ) THEN
    ALTER TABLE public.artifacts
      ADD CONSTRAINT artifacts_report_key_kind_check
      CHECK (
        artifact_key <> 'report' OR kind = 'report'
      );
  END IF;
END;
$$;

ALTER TABLE public.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_org_id_run_id_kind_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.artifacts'::regclass
      AND conname = 'artifacts_org_run_artifact_key_unique'
  ) THEN
    ALTER TABLE public.artifacts
      ADD CONSTRAINT artifacts_org_run_artifact_key_unique
      UNIQUE (org_id, run_id, artifact_key);
  END IF;
END;
$$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_agent TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND conname = 'messages_sender_agent_check'
  ) THEN
    ALTER TABLE public.messages
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
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS messages_run_sender_agent_page
  ON public.messages (org_id, run_id, sender_agent, created_at, id)
  WHERE run_id IS NOT NULL AND sender_agent IS NOT NULL;

-- Preserve the existing RLS/direct-write posture explicitly for both changed
-- tables. No new table or policy broadens authenticated access.
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

-- Keep the new owner/analyst-only workflow artifacts private through their
-- immutable relationship tables as well. The function must bypass artifact
-- RLS to distinguish a hidden private row from an absent one.
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
