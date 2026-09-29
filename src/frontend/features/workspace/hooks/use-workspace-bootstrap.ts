import { useCallback, useEffect, useState } from 'react';
import type { Catalog } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { getCatalog } from '../api/catalog';

export function useWorkspaceBootstrap(orgId: string, onError: (message: string) => void) {
  const [catalog, setCatalog] = useState<Catalog>({ projects: [], latest_snapshot_date: null });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [project, setProject] = useState('');
  const [dataAsOf, setDataAsOf] = useState('');
  const refreshCatalog = useCallback(async () => {
    const value = await getCatalog(orgId);
    setCatalog(value);
    setProject((current) =>
      value.projects.some((item) => item.project_external_id === current)
        ? current
        : (value.projects[0]?.project_external_id ?? ''),
    );
    setDataAsOf((current) => current || value.latest_snapshot_date || '');
  }, [orgId]);
  useEffect(() => {
    void refreshCatalog()
      .catch((cause: unknown) => onError(errorMessage(cause)))
      .finally(() => setCatalogLoading(false));
  }, [refreshCatalog, onError]);
  return { catalog, catalogLoading, project, setProject, dataAsOf, setDataAsOf, refreshCatalog };
}
