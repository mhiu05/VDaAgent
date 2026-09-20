'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading-screen">
      <h1>Không thể mở trang</h1>
      <p>Đã xảy ra lỗi. Hãy tải lại không gian làm việc.</p>
      <button className="primary" onClick={reset}>
        Thử lại
      </button>
    </main>
  );
}
