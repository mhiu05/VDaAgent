import { useCallback, useEffect, useState } from 'react';
import { SetupSchema, type Session } from '@vda/contracts';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import { getSession, getSetup } from '../api/session';

export function organizationFromSession(session: Session, requestedOrgId: string | null) {
  return session.organizations.some((organization) => organization.org_id === requestedOrgId)
    ? requestedOrgId!
    : (session.organizations[0]?.org_id ?? '');
}

export function useSessionBootstrap(requestedOrgId: string | null) {
  const [setup, setSetup] = useState<z.infer<typeof SetupSchema> | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [orgId, setOrgId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialize = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSetup(await getSetup());
      try {
        const next = await getSession();
        setSession(next);
        setOrgId(organizationFromSession(next, requestedOrgId));
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 401)) throw cause;
        setSession(null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [requestedOrgId]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  return { setup, session, setSession, orgId, setOrgId, loading, error, setError, initialize };
}
