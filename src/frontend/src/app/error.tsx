'use client';

import { MascotAvatar } from '../components/assistant';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading-screen" role="alert">
      <MascotAvatar decorative state="error" size={58} />
      <span className="eyebrow">VDa NAVIGATOR · LỖI</span>
      <h1>Không thể mở trang</h1>
      <p>Đã xảy ra lỗi. Hãy tải lại không gian làm việc.</p>
      <button className="primary" onClick={reset}>
        Thử lại
      </button>
    </main>
  );
}
