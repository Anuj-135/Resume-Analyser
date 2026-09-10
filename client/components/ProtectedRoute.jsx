"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isInitialized } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Only redirect if auth status check has definitively resolved as unauthenticated
    if (isInitialized && !isAuthenticated) {
      const nextParam = pathname ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/auth/login${nextParam}`);
    }
  }, [isAuthenticated, isInitialized, router, pathname]);

  // Prevent flicker: While the initial session check (/api/auth/me) is unresolved, display loading
  if (!isInitialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50/50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-500/20 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-gray-500 font-medium">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // If not authenticated after initialization, render nothing while redirect occurs
  if (!isAuthenticated) {
    return null;
  }

  return children;
}
