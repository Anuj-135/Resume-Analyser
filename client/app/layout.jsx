"use client";

import { useEffect } from "react";
import "./globals.css";
import { useAuthStore } from "../lib/store";

export default function RootLayout({ children }) {
  const fetchMe = useAuthStore((state) => state.fetchMe);

  useEffect(() => {
    // Initialize auth check on mount
    fetchMe();
  }, [fetchMe]);

  return (
    <html lang="en">
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}

