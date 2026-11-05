import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SOLLUNA — Amazon & Flipkart Marketplace Management',
  description: 'Professional Amazon and Flipkart account, catalog, advertising, shipping and reporting management for Indian sellers. Plans from ₹1,999/month.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
