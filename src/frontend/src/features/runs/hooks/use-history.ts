import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { ReportRecordSchema, RunSchema } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { listReports } from '../../reports/api/reports';
import { listRuns } from '../api/run-history';

export function useHistory(orgId: string, kind: 'runs' | 'reports') {
  const [runs, setRuns] = useState<z.infer<typeof RunSchema>[]>([]);
  const [reports, setReports] = useState<z.infer<typeof ReportRecordSchema>[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      if (kind === 'runs') setRuns((await listRuns(orgId)).runs);
      else setReports((await listReports(orgId)).reports);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [orgId, kind]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { runs, reports, error, loading, refresh };
}
