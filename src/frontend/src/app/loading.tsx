import { MascotAvatar } from '../components/assistant';

export default function Loading() {
  return (
    <main className="loading-screen" role="status">
      <MascotAvatar decorative state="thinking" size={58} />
      <span className="eyebrow">VDa NAVIGATOR</span>
      <p>Đang mở không gian phân tích…</p>
    </main>
  );
}
