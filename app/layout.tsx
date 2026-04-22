import React from "react"
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import './globals.css'
import { AppShell } from '@/components/app-shell'
import { LocationProvider } from '@/context/LocationContext'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'YG-1 AI Assistant | Sales Support System',
  description: 'AI-powered sales assistant for YG-1 cutting tools - manage inquiries, recommend products, and draft quotes',
  generator: 'v0.app',
  icons: {
    icon: '/favicon.ico',
    apple: '/logo.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">
        <LocationProvider>
          <AppShell>
            {children}
          </AppShell>
        </LocationProvider>
        <Toaster richColors position="top-right" closeButton />
        <Analytics />
      </body>
    </html>
  )
}
