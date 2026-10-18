import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Engine from "@/components/Engine";

export const metadata: Metadata = { title: "Lead Shield - Unified Business Platform", description: "Never lose a lead: a customizable CRM with guaranteed lead ownership, escalation and real integrations." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full"><Engine>{children}</Engine></body>
    </html>
  );
}
