import Image from 'next/image';

export default function Loading() {
  return (
    <main className="loading-screen" role="status">
      <Image className="loading-illustration" src="/brand/mascot/navigator-progress-small.webp" alt="" width={256} height={308} priority />
      <span className="eyebrow">VDa NAVIGATOR</span>
      <p>Đang mở không gian phân tích…</p>
    </main>
  );
}
