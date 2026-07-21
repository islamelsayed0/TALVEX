import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Talvex",
  description:
    "All in one IT operations platform: monitoring, incidents, ticketing, and AI support.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The sign in and sign up URLs come from NEXT_PUBLIC_CLERK_SIGN_IN_URL and
  // NEXT_PUBLIC_CLERK_SIGN_UP_URL, so the proxy redirect and these client
  // widgets agree on one source of truth. Setting them here as well would let
  // the two drift apart.
  return (
    <ClerkProvider afterSignOutUrl="/">
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
