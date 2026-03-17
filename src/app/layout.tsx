import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import Sidebar from "@/components/Sidebar";
import React from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PinListicle — AI Listicle Studio",
  description: "Generate beautiful Pinterest-optimized listicles at scale with AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen overflow-hidden bg-[#f0f2f5]">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-8 py-8 animate-slide-up">
              {children}
            </div>
          </main>
        </div>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
