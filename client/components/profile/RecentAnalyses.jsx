"use client";

import Link from "next/link";
import { ChevronRight, Calendar, Building2 } from "lucide-react";
import ScoreBadge from "@/components/ScoreBadge";

export default function RecentAnalyses({ analyses = [] }) {
  if (!analyses || analyses.length === 0) {
    return null;
  }

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">Recent Analyses</h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Latest evaluated resumes — click any analysis to view its detailed report
          </p>
        </div>

        <Link
          href="/resume-history"
          className="text-xs sm:text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1 self-start sm:self-auto"
        >
          View all history
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {analyses.map((item) => {
          const formattedDate = item.createdAt
            ? new Date(item.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "—";

          return (
            <Link
              key={item.id}
              href={`/resume/${item.id}`}
              className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 rounded-2xl bg-gray-50/70 hover:bg-indigo-50/40 border border-gray-100 hover:border-indigo-100 transition-all duration-200 gap-3 cursor-pointer"
            >
              <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                <div className="p-2 rounded-xl bg-white border border-gray-100 text-gray-500 group-hover:text-indigo-600 group-hover:border-indigo-200 transition-colors shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>

                <div className="flex flex-col min-w-0">
                  <span className="text-base font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                    {item.jobTitle || "Untitled Role"}
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span className="font-semibold text-gray-700 truncate">
                      {item.companyName || "Unnamed Company"}
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-gray-400" />
                      {formattedDate}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 self-end sm:self-center">
                {typeof item.score === "number" ? (
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={item.score} />
                    <span className="text-sm font-extrabold text-gray-900 min-w-[50px] text-right">
                      {item.score}/100
                    </span>
                  </div>
                ) : (
                  <span className="text-xs font-medium text-gray-400">Processing</span>
                )}
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
