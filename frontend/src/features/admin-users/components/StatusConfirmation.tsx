import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Principal } from '../../../shared/contracts/auth';
import type { ServiceResult } from '../../../shared/contracts/service-result';
import { Button } from '../../../shared/ui/button';
import { InlineAlert } from '../../../shared/ui/feedback';
import { RepositoryError } from '../../reports/model/types';
import type { ErrorCode } from '../../reports/model/types';
import type { AccountStatus, ManagedUser } from '../model/types';
import type { AdminUsersService } from '../services/admin-users-service';
import { createStatusController } from '../model/status-controller';

export function StatusConfirmation({ principal, user, status, service, onDone, onClose }: { principal: Principal; user: ManagedUser; status: AccountStatus; service: AdminUsersService; onDone(success: boolean): void; onClose(): void }) {
  const { t } = useTranslation('admin-users'); const cancel = useRef<HTMLButtonElement>(null);
  const [controller] = useState(() => {
    const unwrap = async <T,>(request: Promise<ServiceResult<T>>): Promise<T> => { const result = await request; if (result.error) throw new RepositoryError(result.error.code as ErrorCode, result.error.messageKey); return result.data; };
    const instance = createStatusController({ readDetail: id => unwrap(service.detail(principal, id)), changeStatus: command => unwrap(service.changeStatus(principal, command)) }, () => crypto.randomUUID());
    instance.request(user, status); return instance;
  });
  const [state, setState] = useState(controller.getState);
  useEffect(() => { const frame = requestAnimationFrame(() => cancel.current?.focus()); return () => cancelAnimationFrame(frame); }, []);
  async function submit(retry = false) {
    const request = retry ? controller.retry() : controller.confirm(); setState(controller.getState());
    const next = await request; setState(next); if (next.state === 'success') onDone(true);
  }
  const pending = state.state === 'pending';
  return <div className="admin-status-confirmation stack">
    <div className="admin-confirm-target"><strong>{user.name}</strong><span>{user.email}</span><span>{t(user.status)} → {t(status)} · {t('revision')} {user.revision}</span></div>
    <p className="muted">{t('confirmNote')}</p>
    {state.state === 'success' ? <><InlineAlert>{t('success')}</InlineAlert><Button onClick={onClose}>{t('close')}</Button></> : <>
      {state.state === 'error' ? <InlineAlert kind="error">{t(state.error.code === 'conflict' ? 'conflict' : state.latest ? 'failed' : 'unknown')}{state.latest ? <p>{t('status')}: {t(state.latest.user.status)} · {t('revision')} {state.latest.user.revision}</p> : null}</InlineAlert> : null}
      {pending ? <p role="status">{t('pending')}</p> : null}
      <div className="admin-confirm-actions"><Button ref={cancel} onClick={onClose} disabled={pending}>{t('cancel')}</Button>{state.state === 'error' && state.error.code === 'conflict' ? <Button onClick={() => { onDone(false); onClose(); }}>{t('latest')}</Button> : <Button variant={status === 'disabled' ? 'danger' : 'primary'} pending={pending} onClick={() => void submit(state.state === 'error')}>{t(state.state === 'error' ? 'retry' : 'confirm')}</Button>}</div>
      {'command' in state ? <p className="muted admin-operation">{t('operation')}: {state.command.operationId}</p> : null}
    </>}
  </div>;
}
