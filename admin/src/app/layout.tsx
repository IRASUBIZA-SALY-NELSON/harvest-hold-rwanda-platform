import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { ToastProvider } from '@/components/ui';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Harvest Hold Admin', template: '%s · Harvest Hold Admin' },
  description: 'Operations portal for Harvest Hold Rwanda cold rooms, farmers and market.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Theme chosen in the portal wins over the computer's setting; set before paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('hh-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
