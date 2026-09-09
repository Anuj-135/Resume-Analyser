"use client"
import { usePuterStore } from "../lib/puter";
import { useEffect } from "react";
import "./globals.css";
import Script from "next/script";


export default function RootLayout({ children }) {
  const { init } = usePuterStore();

  useEffect(() => {
    init()
  }, [init]);
  return (
    <html
      lang="en"
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
