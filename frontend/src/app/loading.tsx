export default function Loading() {
  return <main className="dashboard-page" aria-live="polite" aria-busy="true">
    <section className="dashboard-loading">
      <span className="dashboard-loading-mark" aria-hidden="true" />
      <div>
        <b>Đang mở không gian làm việc...</b>
        <p>Đang chuẩn bị nội dung trang.</p>
      </div>
    </section>
  </main>;
}
