"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";

const Navbar = () => {
  const router = useRouter();
  const { user, isAuthenticated, logout, loading } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    router.push("/auth/login");
  };

  return (
    <nav className="navbar">
      <Link href="/">
        <p className="text-xl font-bold text-gradient tracking-wide">RESUMEIT</p>
      </Link>

      <div className="flex items-center gap-3">
        {isAuthenticated && user?.name && (
          <span className="hidden sm:inline-block text-xs font-medium text-gray-600 bg-gray-100/80 px-3 py-1 rounded-full">
            {user.name}
          </span>
        )}

        {isAuthenticated ? (
          <button
            id="logout-btn"
            onClick={handleLogout}
            disabled={loading}
            className="inline-flex items-center gap-1.5 primary-button w-fit text-xs sm:text-sm font-semibold px-4 py-1.5 shadow-sm cursor-pointer disabled:opacity-70"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1"
              />
            </svg>
            Log Out
          </button>
        ) : (
          <Link
            id="login-btn"
            href="/auth/login"
            className="inline-flex items-center gap-1.5 primary-button w-fit text-xs sm:text-sm font-semibold px-4 py-1.5 shadow-sm"
          >
            Log In
          </Link>
        )}
      </div>
    </nav>
  );
};

export default Navbar;