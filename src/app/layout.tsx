import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { SplashDismisser } from "@/components/splash-dismisser";
import { NativeAppDetector } from "@/components/native-app-detector";
import { AppResumeHandler } from "@/components/app-resume-handler";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Huddle",
  description: "クローズドなチームチャットアプリ",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Huddle",
    startupImage: "/icons/icon-512.png",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Huddle" />
        {/* favicon / apple-touch-icon は metadata.icons で /icons/icon-192.png を指定（monoクロのHuddleアプリアイコン） */}
      </head>
      <body className="h-full overflow-x-hidden">
        <ThemeProvider />
        <ServiceWorkerRegister />
        <SplashDismisser />
        <NativeAppDetector />
        <AppResumeHandler />
        {children}
      </body>
    </html>
  );
}
