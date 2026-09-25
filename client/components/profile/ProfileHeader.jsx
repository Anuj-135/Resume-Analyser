"use client";

import Link from "next/link";
import { ArrowLeft, Calendar, Mail, User } from "lucide-react";

export default function ProfileHeader({ user }) {
  const initial = (user?.name?.trim()?.charAt(0) || "U").toUpperCase();

  const formattedDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 flex flex-col gap-6">
      {/* Top action row */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-gray-600 hover:text-indigo-600 bg-gray-100/80 hover:bg-indigo-50 px-3.5 py-1.5 rounded-full transition-all duration-200"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
          Candidate Profile
        </span>
      </div>

      {/* User Information Display */}
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 sm:gap-6 text-center sm:text-left">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-3xl bg-gradient-to-tr from-[#606beb] to-[#8e98ff] text-white text-2xl sm:text-3xl font-extrabold flex items-center justify-center shadow-md select-none shrink-0">
          {initial}
        </div>

        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 truncate">
              {user?.name || "Candidate"}
            </h1>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs sm:text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="truncate">{user?.email || "—"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
              <span>Member since {formattedDate}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
