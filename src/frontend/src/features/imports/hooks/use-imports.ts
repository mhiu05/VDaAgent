import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { ImportManifestSchema } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { listImports, submitImport } from '../api/imports';

export function useImports(orgId: string, onImported: () => Promise<void>) {
  const [imports, setImports] = useState<z.infer<typeof ImportManifestSchema>[]>([]);
  const [csv, setCsv] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setImports((await listImports(orgId)).imports);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [orgId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  function submit() {
    setBusy(true);
    setError('');
    setSuccess('');
    void submitImport(orgId, source, csv)
      .then(async ({ manifest }) => {
        setSuccess(`Đã nhập ${manifest.row_count} dòng từ ${manifest.source_name}.`);
        setCsv('');
        await refresh();
        await onImported();
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  }
  function selectFile(file: File) {
    if (file.size > 2_000_000) {
      setError('Tệp vượt quá giới hạn 2 MB.');
      setCsv('');
      return;
    }
    setSource(file.name);
    void file
      .text()
      .then(setCsv)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }
  return { imports, csv, source, setSource, busy, error, success, loading, submit, selectFile };
}
