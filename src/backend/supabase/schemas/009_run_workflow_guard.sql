-- Existing legacy runs remain readable and may finish their lifecycle during
-- the drain window. Only new rows must use the agent workflow.
CREATE FUNCTION private.guard_run_workflow_version() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  old_version text;
  new_version text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object'
      OR jsonb_typeof(NEW.payload->'workflow_version') IS DISTINCT FROM 'string'
      OR NEW.payload->>'workflow_version' IS DISTINCT FROM 'agent-v1' THEN
      RAISE EXCEPTION 'NEW_RUN_REQUIRES_AGENT_V1' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  old_version := CASE
    WHEN OLD.payload ? 'workflow_version' THEN OLD.payload->>'workflow_version'
    ELSE 'legacy-v1'
  END;
  new_version := CASE
    WHEN NEW.payload ? 'workflow_version' THEN NEW.payload->>'workflow_version'
    ELSE 'legacy-v1'
  END;
  IF new_version IS DISTINCT FROM old_version THEN
    RAISE EXCEPTION 'RUN_WORKFLOW_VERSION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_run_workflow_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER runs_guard_workflow_version
  BEFORE INSERT OR UPDATE OF payload ON public.runs
  FOR EACH ROW EXECUTE FUNCTION private.guard_run_workflow_version();
