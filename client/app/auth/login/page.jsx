"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { getSafeRedirectUrl } from "@/lib/utils";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const { login, isAuthenticated, loading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  // Clear any existing errors when unmounting or switching
  useEffect(() => {
    clearError();
  }, [clearError]);

  // If already authenticated, redirect to destination
  useEffect(() => {
    if (isAuthenticated) {
      router.replace(getSafeRedirectUrl(next));
    }
  }, [isAuthenticated, next, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");

    if (!email || !password) {
      setLocalError("Please fill in both email and password.");
      return;
    }

    const result = await login({ email, password });
    if (result.success) {
      router.push(getSafeRedirectUrl(next));
    }
  };

  const registerHref = next
    ? `/auth/register?next=${encodeURIComponent(next)}`
    : "/auth/register";

  return (
    <main className="bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 bg-cover min-h-screen flex items-center justify-center p-4">
      <div className="gradient-border shadow-xl max-w-md w-full">
        <section className="flex flex-col gap-6 bg-white rounded-2xl p-6 sm:p-10">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-3xl sm:text-4xl font-bold">Welcome Back</h1>
            <h2 className="text-xs sm:text-sm text-gray-500">
              Log in to continue optimizing your resume
            </h2>
          </div>

          {(localError || error) && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm rounded-xl text-center">
              {localError || error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
            <div className="form-div">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Email Address
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div className="form-div">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="primary-button !w-full !rounded-xl py-3 mt-2 text-sm sm:text-base font-semibold transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Signing you in...
                </span>
              ) : (
                "Log In"
              )}
            </button>
          </form>

          <div className="pt-2 text-center text-xs sm:text-sm text-gray-500">
            Don&apos;t have an account?{" "}
            <Link
              href={registerHref}
              className="text-indigo-600 font-semibold hover:underline"
            >
              Sign up
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}