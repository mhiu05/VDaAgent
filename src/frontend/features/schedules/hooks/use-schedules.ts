import { useCallback, useEffect, useState } from 'react';
import type { ReportDefinition } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { listReportDefinitions } from '../api/report-definitions';

export function useSchedules(orgId: string) {
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    setDefinitions((await listReportDefinitions(orgId)).definitions);
  }, [orgId]);
  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(errorMessage(cause)));
  }, [refresh]);
  async function action(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return { definitions, busy, error, notice, setNotice, refresh, action };
}
