'use client';

import Image from 'next/image';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading-screen" role="alert">
      <Image className="loading-illustration" src="/brand/mascot/navigator-recovery-small.webp" alt="" width={256} height={308} />
      <span className="eyebrow">VDa NAVIGATOR · LỖI</span>
      <h1>Không thể mở trang</h1>
      <p>Đã xảy ra lỗi. Hãy tải lại không gian làm việc.</p>
      <button className="primary" onClick={reset}>
        Thử lại
      </button>
    </main>
  );
}
