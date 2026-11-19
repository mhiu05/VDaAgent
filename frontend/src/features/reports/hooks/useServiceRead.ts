import { useEffect, useState } from 'react';
import type { ServiceResult } from '../../../shared/contracts/service-result';

export function useServiceRead<T>(key: string, read: (signal: AbortSignal) => Promise<ServiceResult<T>>) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; result?: ServiceResult<T> }>({ key });
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => previous.key === key ? previous : { key });
    void read(controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ key, result });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ key, result: { error: { code: 'unavailable', messageKey: 'app.unavailable', retryable: true } } });
    });
    return () => controller.abort();
  }, [key, read, revision]);
  return { result: state.key === key ? state.result : undefined, retry: () => setRevision(v => v + 1) };
}
