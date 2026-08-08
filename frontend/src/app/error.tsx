"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="vi"><body><main className="fatal-error"><p className="eyebrow">ỨNG DỤNG GẶP LỖI</p><h1>Không thể hiển thị màn hình này.</h1><button className="button primary" onClick={reset}>Thử lại</button></main></body></html>;
}
