import type { Metadata } from 'next';
import type { Viewport } from 'next';
import { Be_Vietnam_Pro, Bricolage_Grotesque, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const bodyFont = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-be-vietnam-pro',
});

const displayFont = Bricolage_Grotesque({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-bricolage-grotesque',
});

const codeFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-ibm-plex-mono',
});

export const metadata: Metadata = {
  title: 'VDaAgent · Không gian phân tích',
  description:
    'Phân tích tồn kho bất động sản, truy vết bằng chứng và báo cáo trong một không gian làm việc.',
};

export const viewport: Viewport = {
  themeColor: '#0b1021', // design-token-exception: browser chrome metadata is serialized outside CSS.
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="vi"
      data-theme="midnight-signal"
      className={`${bodyFont.variable} ${displayFont.variable} ${codeFont.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
