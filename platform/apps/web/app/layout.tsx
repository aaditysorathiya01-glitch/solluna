import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SOLLUNA — Amazon & Flipkart Marketplace Management',
  description: 'Professional Amazon and Flipkart account, catalog, advertising, shipping and reporting management for Indian sellers. Plans from ₹1,999/month.',
  icons: { icon: [{ url: '/brand/favicon-64.png', sizes: '64x64', type: 'image/png' }, { url: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' }], apple: '/brand/apple-icon.png' },
  // Temporary test environments (PREVIEW_BANNER set) are kept out of search engines.
  ...(process.env.PREVIEW_BANNER ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans">
        {process.env.PREVIEW_BANNER && (
          <div role="note" className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">{process.env.PREVIEW_BANNER}</div>
        )}
        {children}
      </body>
    </html>
  );
}
