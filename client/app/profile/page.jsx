"use client";

import { useEffect } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuthStore, useResumeStore } from "@/lib/store";
import ProfileHeader from "@/components/profile/ProfileHeader";
import AnalyticsOverview from "@/components/profile/AnalyticsOverview";
import ScoreDistribution from "@/components/profile/ScoreDistribution";
import CategoryScores from "@/components/profile/CategoryScores";
import RecentAnalyses from "@/components/profile/RecentAnalyses";
import { UploadCloud, RefreshCw, AlertCircle } from "lucide-react";

function ProfileDashboard() {
  const authUser = useAuthStore((state) => state.user);
  const {
    profileAnalytics,
    isFetchingAnalytics,
    error,
    getProfileAnalytics,
  } = useResumeStore();

  useEffect(() => {
    getProfileAnalytics();
  }, [getProfileAnalytics]);

  const user = profileAnalytics?.user || authUser || {};
  const analytics = profileAnalytics?.analytics || {
    totalAnalyses: 0,
    averageScore: null,
    highestScore: null,
    lowestScore: null,
    scoreDistribution: { high: 0, medium: 0, low: 0 },
    categoryAverages: {
      ats: null,
      contentQuality: null,
      structure: null,
      toneAndStyle: null,
      keySkills: null,
    },
    recentAnalyses: [],
  };

  const hasAnalyses = (analytics?.totalAnalyses ?? 0) > 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 flex flex-col pt-6 pb-20">
      <Navbar />

      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 flex flex-col gap-8">
        {/* Loading State Skeleton */}
        {isFetchingAnalytics && !profileAnalytics ? (
          <div className="flex flex-col gap-6 animate-pulse">
            <div className="h-44 bg-white/60 rounded-3xl" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-white/60 rounded-3xl" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-72 bg-white/60 rounded-3xl" />
              <div className="h-72 bg-white/60 rounded-3xl" />
            </div>
          </div>
        ) : error && !profileAnalytics ? (
          /* Error State Banner */
          <div className="bg-white/80 backdrop-blur-md rounded-3xl p-8 shadow-sm border border-red-200 flex flex-col items-center justify-center text-center gap-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Failed to load analytics</h2>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">{error}</p>
            </div>
            <button
              onClick={() => getProfileAnalytics()}
              className="primary-button text-xs sm:text-sm font-semibold px-5 py-2 inline-flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        ) : (
          /* Dashboard Content */
          <>
            {/* Account Info Header */}
            <ProfileHeader user={user} />

            {/* Resume Analytics Overview Cards */}
            <AnalyticsOverview analytics={analytics} />

            {!hasAnalyses ? (
              /* Empty State */
              <div className="bg-white/80 backdrop-blur-md rounded-3xl p-10 sm:p-14 text-center border border-gray-100 shadow-sm flex flex-col items-center justify-center max-w-lg mx-auto">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mb-4">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">
                  You haven&apos;t analyzed a resume yet
                </h3>
                <p className="text-sm text-gray-500 max-w-sm mb-6">
                  Upload your target resume along with a job description to receive real-time ATS scoring, category performance, and improvement tips.
                </p>
                <Link
                  href="/upload"
                  className="primary-button px-6 py-3 rounded-full text-sm font-semibold shadow-md inline-flex items-center gap-2"
                >
                  <UploadCloud className="w-4 h-4" />
                  Analyze Your First Resume
                </Link>
              </div>
            ) : (
              /* Analytics Deep-Dive Grid */
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                  <ScoreDistribution
                    distribution={analytics.scoreDistribution}
                    total={analytics.totalAnalyses}
                  />
                  <CategoryScores
                    categoryAverages={analytics.categoryAverages}
                  />
                </div>

                {/* Recent Analyses Section */}
                <RecentAnalyses analyses={analytics.recentAnalyses} />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <ProfileDashboard />
    </ProtectedRoute>
  );
}
