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
        {isAuthenticated && (
          <Link
            id="user-avatar-btn"
            href="/profile"
            title={user?.name ? `${user.name} - View Profile` : "View Profile"}
            aria-label="View Profile"
            className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-tr from-[#606beb] to-[#8e98ff] text-white text-xs sm:text-sm font-bold shadow-sm hover:scale-105 hover:shadow-indigo-500/25 transition-all duration-200 cursor-pointer select-none"
          >
            {(user?.name?.trim()?.charAt(0) || "U").toUpperCase()}
          </Link>
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