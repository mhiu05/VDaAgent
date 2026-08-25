'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  connectGoogleCalendar,
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarStatus,
  listCalendarEvents,
  type CalendarEvent,
  type CalendarStatus,
} from '@/lib/api';
import { ApiError } from '@/lib/api';
import { LoadingButton } from '@/components/ui';

function localDateTime(daysFromNow = 0, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function CalendarPage() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [summary, setSummary] = useState('');
  const [start, setStart] = useState(localDateTime(0, 9));
  const [end, setEnd] = useState(localDateTime(0, 10));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [nextStatus, nextEvents] = await Promise.all([
        getCalendarStatus(),
        listCalendarEvents({ limit: 50 }),
      ]);
      setStatus(nextStatus);
      setEvents(nextEvents.events);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể tải lịch.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'p170-google-calendar') return;
      if (event.data.status === 'connected') void load();
      else setError('Kết nối Google Calendar chưa hoàn tất.');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [load]);

  const upcoming = useMemo(
    () => events.filter((event) => event.status !== 'cancelled'),
    [events],
  );

  async function connect() {
    setConnecting(true);
    setError('');
    try {
      await connectGoogleCalendar();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể kết nối Google Calendar.');
    } finally {
      setConnecting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await createCalendarEvent({
        summary,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
        description,
        location,
        attendees: attendees.split(',').map((item) => item.trim()).filter(Boolean),
      });
      setSummary('');
      setDescription('');
      setLocation('');
      setAttendees('');
      setMessage('Đã tạo lịch hẹn.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể tạo lịch hẹn.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(eventId: string) {
    if (!window.confirm('Bạn có chắc muốn hủy lịch hẹn này không?')) return;
    setCancellingId(eventId);
    setBusy(true);
    setError('');
    try {
      await deleteCalendarEvent(eventId);
      setMessage('Đã hủy lịch hẹn.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể hủy lịch hẹn.');
    } finally {
      setBusy(false);
      setCancellingId(null);
    }
  }

  return (
    <main className='page'>
      <header className='page-header'>
        <div>
          <p className='eyebrow'>ANALYST CALENDAR</p>
          <h1>Lịch hẹn</h1>
          <p className='page-description'>Xem, tạo và hủy lịch hẹn trong Google Calendar của bạn.</p>
        </div>
        <div className='inline-actions'>
          <LoadingButton className='button secondary' type='button' onClick={() => void load()} busy={busy}>Làm mới</LoadingButton>
          <LoadingButton className='button primary' type='button' onClick={() => void connect()} busy={connecting} disabled={busy || !status?.can_connect}>
            {status?.connected ? 'Kết nối lại Google' : 'Kết nối Google Calendar'}
          </LoadingButton>
        </div>
      </header>

      {error && <div className='notice error'>{error}</div>}
      {message && <div className='notice success'>{message}</div>}
      {!status?.configured && <div className='notice warning'>Backend chưa có GOOGLE_CALENDAR_CLIENT_ID, CLIENT_SECRET và TOKEN_ENCRYPTION_KEY.</div>}
      {status?.configured && !status.connected && <div className='notice info'>Hãy kết nối Google Calendar trước khi tạo hoặc xem lịch.</div>}

      <section className='workspace-section'>
        <div className='workspace-section-heading'><div><p className='eyebrow'>CREATE EVENT</p><h2>Tạo lịch hẹn</h2></div></div>
        <form className='workspace-create-form' onSubmit={submit}>
          <label>Tiêu đề<input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder='Ví dụ: Review profile với team' required maxLength={200} /></label>
          <label>Bắt đầu<input type='datetime-local' value={start} onChange={(event) => setStart(event.target.value)} required /></label>
          <label>Kết thúc<input type='datetime-local' value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
          <label>Địa điểm<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder='Phòng họp hoặc link' /></label>
          <label>Người tham dự<input value={attendees} onChange={(event) => setAttendees(event.target.value)} placeholder='a@example.com, b@example.com' /></label>
          <label>Mô tả<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
          <LoadingButton className='button primary' type='submit' busy={busy} disabled={!status?.connected}>Tạo lịch</LoadingButton>
        </form>
      </section>

      <section className='workspace-section'>
        <div className='workspace-section-heading'><div><p className='eyebrow'>UPCOMING</p><h2>Lịch sắp tới</h2></div><span className='workspace-count'>{upcoming.length} lịch</span></div>
        {!status?.connected ? <p className='muted'>Chưa kết nối Google Calendar.</p> : upcoming.length === 0 ? <p className='muted'>Không có lịch trong 7 ngày tới.</p> : (
          <div className='workspace-table-wrap'><table className='workspace-member-table'><thead><tr><th>Lịch hẹn</th><th>Thời gian</th><th>Địa điểm</th><th /></tr></thead><tbody>
            {upcoming.map((item) => <tr key={item.id}><td><b>{item.summary}</b>{item.description && <small>{item.description}</small>}</td><td>{displayDate(item.start)}<br />→ {displayDate(item.end)}</td><td>{item.location || '—'}</td><td><LoadingButton className='button danger' type='button' onClick={() => void cancel(item.id)} busy={cancellingId === item.id} disabled={busy && cancellingId !== item.id}>Hủy</LoadingButton></td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  );
}
