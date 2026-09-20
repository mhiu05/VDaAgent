import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VDaAgent · Không gian phân tích',
  description:
    'Phân tích tồn kho bất động sản, truy vết bằng chứng và báo cáo trong một không gian làm việc.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
