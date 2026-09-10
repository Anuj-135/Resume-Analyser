"use client";

import { useEffect } from "react";
import Script from "next/script";
import "./globals.css";
import { useAuthStore } from "../lib/store";
import { usePuterStore } from "../lib/puter";

export default function RootLayout({ children }) {
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const { init } = usePuterStore();

  useEffect(() => {
    // Initialize auth check on mount
    fetchMe();
    // Initialize Puter SDK for FS/KV/AI compatibility
    init();
  }, [fetchMe, init]);

  return (
    <html lang="en">
      <head>
        <Script
          src="https://js.puter.com/v2/"
          strategy="afterInteractive"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
